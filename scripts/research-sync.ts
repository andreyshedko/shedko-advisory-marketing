import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { syncGithubResearch } from "../lib/research-github";
import { pool } from "../lib/db";
try {
  console.log(JSON.stringify(await syncGithubResearch(true)));
} catch {
  console.error(
    "Research sync failed. Check server access settings and the research integration status.",
  );
  process.exitCode = 1;
} finally {
  await pool().end();
}
