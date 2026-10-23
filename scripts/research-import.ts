import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { readFile, stat } from "node:fs/promises";
import { importResearch, researchPayload } from "../lib/research";
import { pool } from "../lib/db";
import { ZodError } from "zod";
let localDatabaseUsed = false;
try {
  const filename = process.argv[2];
  if (!filename)
    throw new Error(
      "Usage: npm run research:import -- /absolute/path/to/research.json",
    );
  if ((await stat(filename)).size > 1_000_000)
    throw new Error("Research JSON exceeds 1 MB");
  const payload = researchPayload.parse(
    JSON.parse(await readFile(filename, "utf8")),
  );
  const endpoint = process.env.RESEARCH_INGEST_URL;
  if (endpoint) {
    const target = new URL(endpoint);
    if (target.username || target.password || target.search || target.hash)
      throw new Error(
        "Import endpoint must not contain credentials, query parameters or fragments",
      );
    if (
      target.protocol !== "https:" &&
      !(
        target.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
      )
    )
      throw new Error("Import endpoint requires HTTPS (except localhost)");
    const secret = process.env.RESEARCH_INGEST_SECRET;
    if (!secret || secret.length < 24)
      throw new Error("Configure RESEARCH_INGEST_SECRET (24+ characters)");
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(
        `Research endpoint returned HTTP ${response.status}; keep the same runId for a retry`,
      );
    console.log(JSON.stringify(await response.json()));
  } else {
    localDatabaseUsed = true;
    console.log(
      JSON.stringify(
        await importResearch(payload, "local", "codex_research_import"),
      ),
    );
  }
} catch (error) {
  console.error(
    error instanceof ZodError
      ? "Invalid research format; validate against docs/RESEARCH_INTEGRATION.md"
      : error instanceof SyntaxError
        ? "Invalid JSON"
        : error instanceof Error &&
            /^(Usage:|Research JSON|Import endpoint|Configure RESEARCH_|Research endpoint)/.test(
              error.message,
            )
          ? error.message
          : "Research import failed. Keep the input file unchanged and retry; credentials and internal diagnostics are not printed.",
  );
  process.exitCode = 1;
} finally {
  if (localDatabaseUsed) await pool().end();
}
