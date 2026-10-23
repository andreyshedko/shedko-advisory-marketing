import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { pool } from "./db";
import { importResearch } from "./research";
import { ensure } from "./validation";
const execute = promisify(execFile);
export function githubResearchConfigured() {
  return Boolean(
    process.env.RESEARCH_GITHUB_REPOSITORY &&
      (process.env.RESEARCH_GITHUB_TOKEN ||
        process.env.RESEARCH_GITHUB_PUBLIC === "true" ||
        (!process.env.VERCEL &&
          process.env.RESEARCH_GITHUB_LOCAL_CLI === "true")),
  );
}
async function githubJson(endpoint: string): Promise<unknown> {
  const token = process.env.RESEARCH_GITHUB_TOKEN;
  if (token || process.env.RESEARCH_GITHUB_PUBLIC === "true") {
    const r = await fetch(`https://api.github.com/${endpoint}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-GitHub-Api-Version": "2026-03-10",
      },
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    ensure(r.ok, `Research GitHub request failed (HTTP ${r.status})`);
    return r.json();
  }
  ensure(
    !process.env.VERCEL && process.env.RESEARCH_GITHUB_LOCAL_CLI === "true",
    "Configure a repository-scoped read-only token for the research inbox",
  );
  const r = await execute("gh", ["api", endpoint], {
    timeout: 15000,
    maxBuffer: 2_000_000,
    env: {
      ...process.env,
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
    },
  });
  return JSON.parse(r.stdout);
}
const fileSchema = z.object({
  name: z.string(),
  path: z.string(),
  sha: z.string().regex(/^[a-f0-9]{40,64}$/),
  type: z.string(),
  size: z.number().int().nonnegative(),
});
export async function syncGithubResearch(force = false) {
  ensure(githubResearchConfigured(), "Research inbox is not connected");
  const repository = z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
    .parse(process.env.RESEARCH_GITHUB_REPOSITORY);
  const branch =
    process.env.RESEARCH_GITHUB_BRANCH || "codex/marketing-automation";
  const claim = await pool().query(
    `INSERT INTO integration_status(name,status,detail) VALUES('research_github','syncing','Checking the research inbox') ON CONFLICT(name) DO UPDATE SET status='syncing',updated_at=now(),detail=EXCLUDED.detail WHERE (integration_status.status<>'syncing' AND ($1::boolean OR integration_status.updated_at<now()-interval '5 minutes')) OR integration_status.updated_at<now()-interval '2 minutes' AND integration_status.status='syncing' RETURNING name`,
    [force],
  );
  if (!claim.rowCount) return { skipped: true };
  try {
    const list = z
      .array(fileSchema)
      .max(1000)
      .parse(
        await githubJson(
          `repos/${repository}/contents/research/batches?ref=${encodeURIComponent(branch)}`,
        ),
      );
    const known = (
      await pool().query(
        "SELECT path,sha FROM research_remote_files WHERE repository=$1",
        [repository],
      )
    ).rows;
    const seen = new Map<string, string>(known.map((r) => [r.path, r.sha]));
    const pending = list
      .filter(
        (f) =>
          f.type === "file" &&
          /^research\/batches\/[A-Za-z0-9._:-]+\.json$/.test(f.path) &&
          f.size <= 1_000_000 &&
          seen.get(f.path) !== f.sha,
      )
      .sort((a, b) => a.path.localeCompare(b.path));
    let created = 0,
      matched = 0,
      conflicts = 0,
      batches = 0;
    for (const file of pending.slice(0, 3)) {
      const blob = z
        .object({
          sha: z.string(),
          encoding: z.literal("base64"),
          content: z.string().max(1_500_000),
          size: z.number().max(1_000_000),
        })
        .parse(
          await githubJson(
            `repos/${repository}/contents/${file.path}?ref=${encodeURIComponent(branch)}`,
          ),
        );
      ensure(
        blob.sha === file.sha,
        "Research file changed during sync; retry the immutable batch",
      );
      const payload = JSON.parse(
        Buffer.from(blob.content, "base64").toString("utf8"),
      );
      const result = await importResearch(
        payload,
        "github",
        "github_research_sync",
      );
      await pool().query(
        "INSERT INTO research_remote_files(repository,path,sha) VALUES($1,$2,$3) ON CONFLICT(repository,path) DO UPDATE SET sha=EXCLUDED.sha,imported_at=now()",
        [repository, file.path, file.sha],
      );
      if (!result.replayed) {
        created += result.created;
        matched += result.matched;
        conflicts += result.conflicts;
      }
      batches++;
    }
    const result = {
      batches,
      created,
      matched,
      conflicts,
      pending: Math.max(0, pending.length - batches),
    };
    await pool().query(
      `UPDATE integration_status SET status='connected',last_success_at=now(),updated_at=now(),detail=$1 WHERE name='research_github'`,
      [JSON.stringify(result)],
    );
    return result;
  } catch {
    await pool().query(
      "UPDATE integration_status SET status='error',updated_at=now(),detail='Could not sync research inbox. Verify access and immutable JSON batches; retry manually.' WHERE name='research_github'",
    );
    throw new Error(
      "Research inbox sync failed; no messages or forms were sent",
    );
  }
}
