import { beforeAll, beforeEach, afterAll } from "vitest";
import { config } from "dotenv";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
config({ path: ".env.local", quiet: true });
const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!base)
  throw new Error("Run npm run local:setup or configure TEST_DATABASE_URL");
const testUrl = new URL(base);
testUrl.pathname = "/shedko_marketing_test";
process.env.DATABASE_URL = testUrl.toString();
const { pool } = await import("../lib/db");
beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: base });
  try {
    if (
      !(
        await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
          "shedko_marketing_test",
        ])
      ).rowCount
    )
      await admin.query("CREATE DATABASE shedko_marketing_test");
  } finally {
    await admin.end();
  }
  const db = pool();
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const file of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const exists = (
      await db.query("SELECT 1 FROM schema_migrations WHERE version=$1", [file])
    ).rowCount;
    if (exists) continue;
    if (
      file === "001_initial.sql" &&
      (
        await db.query(
          "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations'",
        )
      ).rowCount
    ) {
      await db.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        file,
      ]);
      continue;
    }
    await db.query(await readFile(`migrations/${file}`, "utf8"));
    await db.query("INSERT INTO schema_migrations(version) VALUES($1)", [file]);
  }
});
beforeEach(async () => {
  await pool().query(
    'TRUNCATE research_remote_files,research_records,research_runs,opportunity_events,marketing_reports,organizations,contacts,evidence,partner_programs,partner_applications,outreach_messages,outreach_events,suppressions,tasks,opportunities,campaigns,spend_records,activity_log,integration_status,job_runs,discovery_results,"user",session,account,verification,"rateLimit" CASCADE',
  );
  for (const key of [
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
    "OUTREACH_FOOTER",
    "BRAVE_SEARCH_API_KEY",
    "RESEARCH_GITHUB_REPOSITORY",
    "RESEARCH_GITHUB_TOKEN",
    "RESEARCH_GITHUB_PUBLIC",
    "RESEARCH_GITHUB_LOCAL_CLI",
    "RESEARCH_INGEST_SECRET",
  ])
    delete process.env[key];
  process.env.DAILY_BUDGETS = "{}";
});
afterAll(async () => {
  await pool().end();
  delete (globalThis as { marketingPool?: unknown }).marketingPool;
});
