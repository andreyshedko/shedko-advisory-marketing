import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db";
import { audit } from "./audit";
import {
  text,
  url,
  normalizeDomain,
  normalizeName,
  ensure,
  BusinessError,
} from "./validation";
export const researchCandidate = z
  .object({
    name: text.max(200),
    website: url,
    country: text.max(100),
    kind: z.enum([
      "advisor",
      "acquirer",
      "search_fund",
      "private_equity",
      "corporate_ma",
      "directory",
      "partner",
    ]),
    relevance: text,
    contactChannel: z.string().trim().max(500).optional(),
    sources: z
      .array(z.object({ url, note: text }))
      .min(1)
      .max(5),
  })
  .strict();
export const researchPayload = z
  .object({
    version: z.literal(1),
    runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/),
    producer: z.enum(["chatgpt", "codex", "manual"]),
    query: text.max(1000),
    researchedAt: z.iso
      .datetime({ offset: true })
      .refine(
        (v) => new Date(v).getTime() <= Date.now() + 300000,
        "Research timestamp cannot be in the future",
      ),
    records: z.array(researchCandidate).min(1).max(50),
  })
  .strict();
export type ResearchPayload = z.infer<typeof researchPayload>;
export interface ResearchResult {
  runId: string;
  created: number;
  matched: number;
  conflicts: number;
  replayed: boolean;
}
export async function importResearch(
  input: unknown,
  transport: "local" | "http" | "manual" | "github",
  actor: string,
): Promise<ResearchResult> {
  const payload = researchPayload.parse(input);
  const hash = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return transaction(async (db) => {
    // Imports are small bounded transactions; serialize domain/name matching across concurrent batches.
    await db.query("SELECT pg_advisory_xact_lock(8734623)");
    const existing = await db.query(
      "SELECT * FROM research_runs WHERE run_key=$1",
      [payload.runId],
    );
    if (existing.rowCount) {
      const run = existing.rows[0];
      if (run.payload_hash !== hash)
        throw new BusinessError(
          "This runId was already imported with different contents. Keep retry payloads unchanged or create a new runId.",
          409,
        );
      return {
        runId: payload.runId,
        created: run.created_count,
        matched: run.matched_count,
        conflicts: run.conflict_count,
        replayed: true,
      };
    }
    const runId = randomUUID();
    await db.query(
      "INSERT INTO research_runs(id,run_key,payload_hash,producer,transport,query,researched_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        runId,
        payload.runId,
        hash,
        payload.producer,
        transport,
        payload.query,
        payload.researchedAt,
      ],
    );
    let created = 0,
      matched = 0,
      conflicts = 0;
    for (const [index, candidate] of payload.records.entries()) {
      const domain = normalizeDomain(candidate.website),
        name = normalizeName(candidate.name);
      ensure(name, "Organization name must contain letters or numbers");
      let rows = (
        await db.query(
          "SELECT id,domain,normalized_name,status FROM organizations WHERE domain=$1 OR normalized_name=$2 FOR UPDATE",
          [domain, name],
        )
      ).rows;
      let organizationId: string | null = null;
      let outcome: "created" | "matched" | "conflict";
      let note: string;
      let isNew = false;
      if (!rows.length) {
        const inserted = await db.query(
          `INSERT INTO organizations(id,name,normalized_name,domain,website,country,kind,relevance,contact_channel) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
          [
            randomUUID(),
            candidate.name,
            name,
            domain,
            candidate.website,
            candidate.country,
            candidate.kind,
            candidate.relevance,
            candidate.contactChannel || null,
          ],
        );
        if (inserted.rowCount) {
          organizationId = inserted.rows[0].id;
          isNew = true;
        } else
          rows = (
            await db.query(
              "SELECT id,domain,normalized_name,status FROM organizations WHERE domain=$1 OR normalized_name=$2 FOR UPDATE",
              [domain, name],
            )
          ).rows;
      }
      if (isNew) {
        outcome = "created";
        note = "Imported as unverified; operator review required";
        created++;
      } else if (rows.length === 1 && rows[0].domain === domain) {
        organizationId = rows[0].id;
        outcome = "matched";
        note =
          "Matched existing domain; existing fields, verification and outreach status preserved";
        matched++;
      } else {
        outcome = "conflict";
        note =
          "Name/domain conflict: review the candidate and existing organizations manually";
        conflicts++;
      }
      let sourcesAdded = 0;
      if (organizationId) {
        for (const source of candidate.sources) {
          const r = await db.query(
            "INSERT INTO evidence(id,organization_id,url,note) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,url) DO NOTHING",
            [randomUUID(), organizationId, source.url, source.note],
          );
          sourcesAdded += r.rowCount || 0;
        }
        const suppressed = rows[0]?.status === "do_not_contact";
        if ((isNew || sourcesAdded > 0) && !suppressed)
          await db.query(
            `INSERT INTO tasks(id,organization_id,title,due_at,dedupe_key) VALUES($1,$2,$3,now(),$4) ON CONFLICT(dedupe_key) DO UPDATE SET status='open',due_at=now() WHERE tasks.status='done'`,
            [
              randomUUID(),
              organizationId,
              `Проверить исследование: ${candidate.name}`,
              `research-review:${organizationId}`,
            ],
          );
      }
      await db.query(
        "INSERT INTO research_records(id,run_id,record_index,organization_id,candidate,outcome,note) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          runId,
          index,
          organizationId,
          JSON.stringify(candidate),
          outcome,
          note,
        ],
      );
    }
    await db.query(
      "UPDATE research_runs SET created_count=$2,matched_count=$3,conflict_count=$4 WHERE id=$1",
      [runId, created, matched, conflicts],
    );
    await db.query(
      `INSERT INTO integration_status(name,status,last_success_at,detail) VALUES('research_ingest','connected',now(),$1) ON CONFLICT(name) DO UPDATE SET status='connected',last_success_at=now(),detail=EXCLUDED.detail,updated_at=now()`,
      [
        `${payload.producer} via ${transport}: ${created} new, ${matched} matched, ${conflicts} conflicts`,
      ],
    );
    await audit(db, actor, "research.imported", runId, {
      runKey: payload.runId,
      producer: payload.producer,
      transport,
      created,
      matched,
      conflicts,
    });
    return {
      runId: payload.runId,
      created,
      matched,
      conflicts,
      replayed: false,
    };
  });
}
