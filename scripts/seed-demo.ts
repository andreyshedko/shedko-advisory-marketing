import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { randomUUID } from "node:crypto";
import { pool, transaction } from "../lib/db";
try {
  await transaction(async (db) => {
    const id = randomUUID();
    const inserted = await db.query(
      "INSERT INTO organizations(id,name,normalized_name,domain,website,country,kind,relevance,demo,contact_channel) VALUES($1,'DEMO · Example Software Acquirer','demoexamplesoftwareacquirer','example.com','https://example.com','Demo country','acquirer','DEMO: fictional illustration of an international software acquirer; not a verified prospect.',true,'DEMO: add a real public contact only after independent research') ON CONFLICT(domain) DO NOTHING RETURNING id",
      [id],
    );
    if (inserted.rowCount)
      await db.query(
        "INSERT INTO evidence(id,organization_id,url,note) VALUES($1,$2,'https://example.com','DEMO: reserved example domain; no real company evidence')",
        [randomUUID(), id],
      );
  });
  console.log(
    "Optional demo organization inserted; demo email sending is blocked.",
  );
} finally {
  await pool().end();
}
