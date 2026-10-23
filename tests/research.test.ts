import { afterEach, it, expect, vi } from "vitest";
import { pool } from "../lib/db";
import { importResearch } from "../lib/research";
import { operate } from "../lib/operations";
import { syncGithubResearch } from "../lib/research-github";
import { POST } from "../app/api/research/ingest/route";
const candidate = {
  name: "Example Acquirer",
  website: "https://acquirer.example.com",
  country: "Not confirmed",
  kind: "acquirer",
  relevance: "Synthetic research fixture, not a real prospect",
  sources: [
    {
      url: "https://acquirer.example.com/about",
      note: "Synthetic public source",
    },
  ],
};
function batch(runId = "test:2026-10-23") {
  return {
    version: 1,
    runId,
    producer: "chatgpt",
    query: "Software acquirers and M&A partners",
    researchedAt: new Date().toISOString(),
    records: [candidate],
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of [
    "RESEARCH_GITHUB_TOKEN",
    "RESEARCH_GITHUB_REPOSITORY",
    "RESEARCH_GITHUB_LOCAL_CLI",
    "RESEARCH_INGEST_SECRET",
  ])
    delete process.env[key];
});
it("imports unverified companies and source evidence with review tasks, never outreach", async () => {
  const result = await importResearch(batch(), "manual", "test-admin");
  expect(result).toMatchObject({
    created: 1,
    matched: 0,
    conflicts: 0,
    replayed: false,
  });
  expect(
    (await pool().query("SELECT status,verified_at FROM organizations"))
      .rows[0],
  ).toEqual({ status: "discovered", verified_at: null });
  expect(
    (await pool().query("SELECT checked_at FROM evidence")).rows[0].checked_at,
  ).toBeNull();
  expect((await pool().query("SELECT 1 FROM tasks")).rowCount).toBe(1);
  expect((await pool().query("SELECT 1 FROM outreach_messages")).rowCount).toBe(
    0,
  );
  expect((await pool().query("SELECT 1 FROM contacts")).rowCount).toBe(0);
});
it("replays are idempotent and a changed runId payload is rejected", async () => {
  const payload = batch();
  await importResearch(payload, "http", "test");
  const replay = await importResearch(payload, "http", "test");
  expect(replay.replayed).toBe(true);
  await expect(
    importResearch({ ...payload, query: "Changed payload" }, "http", "test"),
  ).rejects.toMatchObject({ status: 409 });
  expect((await pool().query("SELECT 1 FROM research_runs")).rowCount).toBe(1);
  expect((await pool().query("SELECT 1 FROM activity_log")).rowCount).toBe(1);
});
it("concurrent identical imports create one run and one organization", async () => {
  const payload = batch();
  const results = await Promise.all([
    importResearch(payload, "http", "test"),
    importResearch(payload, "http", "test"),
  ]);
  expect(results.filter((r) => r.replayed)).toHaveLength(1);
  expect((await pool().query("SELECT 1 FROM organizations")).rowCount).toBe(1);
});
it("domain matches preserve researched facts and suppression while adding only new evidence", async () => {
  const created = (await operate(
    {
      action: "organization.create",
      data: {
        ...candidate,
        sourceUrl: candidate.sources[0].url,
        sourceNote: "Operator checked",
        verified: true,
      },
    },
    "test",
  )) as { id: string };
  await operate(
    {
      action: "organization.update",
      data: {
        id: created.id,
        status: "do_not_contact",
        nextAction: "Suppressed",
      },
    },
    "test",
  );
  const payload = batch();
  payload.records[0] = {
    ...candidate,
    relevance: "Different AI hypothesis",
    sources: [
      ...candidate.sources,
      { url: "https://acquirer.example.com/new", note: "Needs manual review" },
    ],
  };
  expect(await importResearch(payload, "http", "test")).toMatchObject({
    created: 0,
    matched: 1,
  });
  const o = (await pool().query("SELECT * FROM organizations")).rows[0];
  expect(o.status).toBe("do_not_contact");
  expect(o.relevance).toBe(candidate.relevance);
  expect(o.verified_at).toBeTruthy();
  expect((await pool().query("SELECT 1 FROM tasks")).rowCount).toBe(0);
  expect(
    (
      await pool().query("SELECT note FROM evidence WHERE url=$1", [
        candidate.sources[0].url,
      ])
    ).rows[0].note,
  ).toBe("Operator checked");
  expect((await pool().query("SELECT 1 FROM evidence")).rowCount).toBe(2);
});
it("name/domain conflicts are retained for review without overwriting or merging organizations", async () => {
  await importResearch(batch("first"), "manual", "test");
  const p = batch("second");
  p.records[0] = { ...candidate, website: "https://different.org" };
  expect(await importResearch(p, "http", "test")).toMatchObject({
    conflicts: 1,
    created: 0,
    matched: 0,
  });
  expect((await pool().query("SELECT 1 FROM organizations")).rowCount).toBe(1);
  expect(
    (
      await pool().query(
        "SELECT organization_id FROM research_records WHERE outcome='conflict'",
      )
    ).rows[0].organization_id,
  ).toBeNull();
});
it("rejects auto-verification flags and rolls back an invalid batch atomically", async () => {
  const p = batch();
  await expect(
    importResearch(
      { ...p, records: [{ ...candidate, verified: true }] },
      "http",
      "test",
    ),
  ).rejects.toThrow();
  await expect(
    importResearch(
      {
        ...p,
        records: [
          candidate,
          { ...candidate, name: "Invalid local", website: "http://localhost" },
        ],
      },
      "http",
      "test",
    ),
  ).rejects.toThrow();
  expect((await pool().query("SELECT 1 FROM organizations")).rowCount).toBe(0);
  expect((await pool().query("SELECT 1 FROM research_runs")).rowCount).toBe(0);
});
it("HTTP receiver requires its own bearer token and validates before importing", async () => {
  process.env.RESEARCH_INGEST_SECRET = "test-import-only-secret-long-enough";
  const request = (authorized: boolean, data: unknown = batch()) =>
    new Request("http://localhost/api/research/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorized
          ? { Authorization: `Bearer ${process.env.RESEARCH_INGEST_SECRET}` }
          : {}),
      },
      body: JSON.stringify(data),
    });
  expect((await POST(request(false))).status).toBe(401);
  expect((await POST(request(true, { records: [] }))).status).toBe(400);
  expect((await POST(request(true))).status).toBe(200);
  expect(
    (await pool().query("SELECT transport FROM research_runs")).rows[0]
      .transport,
  ).toBe("http");
});
it("syncs the private GitHub inbox and skips already imported blobs", async () => {
  process.env.RESEARCH_GITHUB_REPOSITORY = "owner/private-research";
  process.env.RESEARCH_GITHUB_TOKEN = "test-read-only-fixture";
  const sha = "a".repeat(40);
  const payload = batch();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json([
        {
          name: "2026-10-23.json",
          path: "research/batches/2026-10-23.json",
          type: "file",
          size: 100,
          sha,
        },
      ]),
    )
    .mockResolvedValueOnce(
      Response.json({
        sha,
        size: 100,
        encoding: "base64",
        content: Buffer.from(JSON.stringify(payload)).toString("base64"),
      }),
    )
    .mockResolvedValueOnce(
      Response.json([
        {
          name: "2026-10-23.json",
          path: "research/batches/2026-10-23.json",
          type: "file",
          size: 100,
          sha,
        },
      ]),
    );
  vi.stubGlobal("fetch", fetchMock);
  expect(await syncGithubResearch(true)).toMatchObject({
    created: 1,
    batches: 1,
  });
  expect(await syncGithubResearch(true)).toMatchObject({
    created: 0,
    batches: 0,
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  const call = fetchMock.mock.calls[0];
  expect(String(call[0])).toContain(
    "https://api.github.com/repos/owner/private-research/contents/research/batches",
  );
  expect(call[1].redirect).toBe("error");
  expect(
    (await pool().query("SELECT transport FROM research_runs")).rows[0]
      .transport,
  ).toBe("github");
});
it("a failed GitHub sync is visible and retryable without claiming successful transfer", async () => {
  process.env.RESEARCH_GITHUB_REPOSITORY = "owner/private-research";
  process.env.RESEARCH_GITHUB_TOKEN = "test-read-only-fixture";
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ message: "Not found" }, { status: 404 }),
      ),
  );
  await expect(syncGithubResearch(true)).rejects.toThrow("sync failed");
  const state = (
    await pool().query(
      "SELECT * FROM integration_status WHERE name='research_github'",
    )
  ).rows[0];
  expect(state.status).toBe("error");
  expect(state.last_success_at).toBeNull();
});

it("manual JSON import reports invalid JSON without a server error", async () => {
  await expect(
    operate({ action: "research.import", data: { json: "{" } }, "test"),
  ).rejects.toMatchObject({ status: 400 });
});
