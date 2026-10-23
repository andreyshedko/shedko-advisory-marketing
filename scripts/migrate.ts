import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { readdir, readFile } from "node:fs/promises";
import { pool, transaction } from "../lib/db";
try {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(8734621)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of (await readdir("migrations"))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      if (
        (
          await db.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
            file,
          ])
        ).rowCount
      )
        continue;
      await db.query(await readFile(`migrations/${file}`, "utf8"));
      await db.query("INSERT INTO schema_migrations(version) VALUES ($1)", [
        file,
      ]);
      console.log(`Applied ${file}`);
    }
  });
} finally {
  await pool().end();
}
