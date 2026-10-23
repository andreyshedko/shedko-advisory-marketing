import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { transaction } from "./db";
import { audit } from "./audit";
import { date, ensure } from "./validation";
export const adRow = z
  .object({
    account_id: z.string().regex(/^\d{3}-?\d{3}-?\d{4}$/),
    campaign_id: z.string().regex(/^\d{1,30}$/),
    campaign: z.string().trim().min(1).max(300),
    date,
    currency: z.string().regex(/^[A-Z]{3}$/),
    impressions: z.coerce.number().int().nonnegative().max(1e12),
    clicks: z.coerce.number().int().nonnegative().max(1e12),
    cost: z.coerce.number().nonnegative().max(1e10),
    conversions: z.coerce.number().nonnegative().max(1e10),
  })
  .refine((v) => v.clicks <= v.impressions, "Clicks cannot exceed impressions");
export function parseAdsCsv(csv: string) {
  ensure(Buffer.byteLength(csv, "utf8") <= 1_000_000, "CSV exceeds 1 MB");
  const rows: unknown[] = parse(csv, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
    max_record_size: 10000,
  });
  ensure(
    rows.length > 0 && rows.length <= 2000,
    "Import between 1 and 2000 daily campaign rows",
  );
  return z.array(adRow).parse(rows);
}
export async function importAds(
  input: unknown,
  source: "csv" | "scripts",
  actor: string,
) {
  const rows = z.array(adRow).min(1).max(2000).parse(input);
  return transaction(async (db) => {
    for (const r of rows) {
      // PostgreSQL also validates calendar dates (e.g. February 30 is rejected atomically).
      await db.query(
        `INSERT INTO campaigns(id,account_id,external_id,name,currency,day,impressions,clicks,cost,conversions,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT(account_id,external_id,day) DO UPDATE SET name=EXCLUDED.name,currency=EXCLUDED.currency,impressions=EXCLUDED.impressions,clicks=EXCLUDED.clicks,cost=EXCLUDED.cost,conversions=EXCLUDED.conversions,source=EXCLUDED.source,imported_at=now()`,
        [
          randomUUID(),
          r.account_id.replaceAll("-", ""),
          r.campaign_id,
          r.campaign,
          r.currency,
          r.date,
          r.impressions,
          r.clicks,
          r.cost,
          r.conversions,
          source,
        ],
      );
    }
    await db.query(
      `INSERT INTO integration_status(name,status,last_success_at,detail) VALUES($1,'connected',now(),$2) ON CONFLICT(name) DO UPDATE SET status='connected',last_success_at=now(),detail=EXCLUDED.detail,updated_at=now()`,
      [
        source === "scripts" ? "google_ads_scripts" : "google_ads_csv",
        `${rows.length} daily rows received`,
      ],
    );
    await audit(db, actor, `ads.${source}_imported`, null, {
      rows: rows.length,
    });
    return { imported: rows.length };
  });
}
