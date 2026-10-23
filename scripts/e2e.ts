import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "../lib/db";
const base = process.env.E2E_URL || "http://localhost:3000";
assert.equal(
  new URL(base).hostname,
  "localhost",
  "E2E creates and deletes synthetic records; run against localhost only",
);
const credentials = await readFile(".local/admin-credentials.txt", "utf8");
const password = credentials.match(/^Password: (.+)$/m)?.[1];
const email = credentials.match(/^Email: (.+)$/m)?.[1];
assert(password && email, "Local credentials missing");
let cookie = "";
const ids: string[] = [];
const accountId = "9999999999";
const campaignId = String(Date.now());
async function request(
  path: string,
  body?: unknown,
  withAuth = true,
  origin = base,
) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(withAuth && cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return response;
}
async function op(action: string, data: unknown, expected = 200) {
  const r = await request("/api/admin", { action, data });
  const json = await r.json();
  assert.equal(r.status, expected, `${action}: ${json.error || r.status}`);
  return json;
}
try {
  assert.equal(
    (
      await request(
        "/api/admin?from=2026-01-01&to=2027-12-31",
        undefined,
        false,
      )
    ).status,
    401,
  );
  assert.equal((await request("/api/cron", undefined, false)).status, 401);
  assert.equal((await request("/api/ads/ingest", [], false)).status, 401);
  const login = await request(
    "/api/auth/sign-in/email",
    { email, password },
    false,
  );
  assert.equal(login.status, 200, "Administrator sign-in");
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert(cookie, "Session cookie missing");
  const signup = await request(
    "/api/auth/sign-up/email",
    {
      email: "uninvited@example.org",
      password: "cannot-sign-up-password",
      name: "Uninvited",
    },
    false,
  );
  assert(signup.status >= 400, "Public signup must be disabled");
  assert.equal(
    (
      await request(
        "/api/admin",
        { action: "jobs.run", data: {} },
        true,
        "https://evil.example",
      )
    ).status,
    403,
  );
  const n = randomUUID();
  const o = await op("organization.create", {
    name: `E2E temporary ${n}`,
    website: `https://qa-${n}.example.org`,
    country: "Test fixture",
    kind: "acquirer",
    relevance: "Synthetic E2E fixture. No real prospect.",
    sourceUrl: "https://example.org",
    sourceNote: "Synthetic QA source",
    verified: true,
  });
  ids.push(o.id);
  const c = await op("contact.create", {
    organizationId: o.id,
    name: "E2E synthetic contact",
    email: "qa@example.org",
    evidenceUrl: "https://example.org/contact",
    verified: true,
  });
  ids.push(c.id);
  const m = await op("message.draft", {
    organizationId: o.id,
    contactId: c.id,
  });
  ids.push(m.id);
  await op("message.approve", { id: m.id, revision: 1, confirmed: true });
  const disabled = await op(
    "message.send",
    { id: m.id, revision: 1, confirmed: true },
    400,
  );
  assert.match(disabled.error, /SMTP is not connected/);
  await op("message.edit", {
    id: m.id,
    subject: "E2E edited draft",
    body: "Synthetic local draft only",
  });
  const task = await op("task.create", {
    organizationId: o.id,
    title: "E2E review source",
    dueAt: new Date(Date.now() + 86400000).toISOString(),
  });
  ids.push(task.id);
  await op("ads.import", {
    csv: `account_id,campaign_id,campaign,date,currency,impressions,clicks,cost,conversions\n${accountId},${campaignId},E2E SYNTHETIC,2026-10-23,USD,100,4,2,0\n`,
  });
  const snapshot = await (
    await request("/api/admin?from=2026-01-01&to=2027-12-31&kind=all")
  ).json();
  assert(snapshot.organizations.some((v: { id: string }) => v.id === o.id));
  assert(
    snapshot.messages.some(
      (v: { id: string; status: string }) =>
        v.id === m.id && v.status === "draft",
    ),
  );
  assert(
    snapshot.activity.some(
      (v: { entity_id: string; action: string }) =>
        v.entity_id === m.id && v.action === "message.approved",
    ),
  );
  assert(
    snapshot.campaigns.some(
      (v: { external_id: string; source: string }) =>
        v.external_id === campaignId && v.source === "csv",
    ),
  );
  for (const path of [
    "/",
    "/organizations",
    "/partners",
    "/outreach",
    "/ads",
    "/spend",
    "/tasks",
    "/reports",
    "/integrations",
    "/activity",
  ]) {
    const r = await request(path);
    assert.equal(r.status, 200, path);
    const html = await r.text();
    assert(html.includes("Shedko Advisory"), path);
  }
  console.log(
    "HTTP E2E PASS: auth, disabled signup, CSRF, cron/Ads protection, organization → source → contact → draft → approve → SMTP disabled, edit approval reset, audit, task, CSV and 10 pages.",
  );
} finally {
  if (ids.length) {
    const db = pool();
    await db.query("DELETE FROM tasks WHERE organization_id=$1", [ids[0]]);
    await db.query(
      "DELETE FROM outreach_events WHERE message_id IN (SELECT id FROM outreach_messages WHERE organization_id=$1)",
      [ids[0]],
    );
    await db.query("DELETE FROM outreach_messages WHERE organization_id=$1", [
      ids[0],
    ]);
    await db.query("DELETE FROM contacts WHERE organization_id=$1", [ids[0]]);
    await db.query("DELETE FROM evidence WHERE organization_id=$1", [ids[0]]);
    await db.query("DELETE FROM organizations WHERE id=$1", [ids[0]]);
    await db.query("DELETE FROM activity_log WHERE entity_id=ANY($1::text[])", [
      ids,
    ]);
  }
  await pool().query(
    "DELETE FROM campaigns WHERE account_id=$1 AND external_id=$2",
    [accountId, campaignId],
  );
  await pool().query(
    "DELETE FROM activity_log WHERE actor=$1 AND action='ads.csv_imported' AND created_at>now()-interval '2 minutes'",
    [email],
  );
  await pool().query(
    "DELETE FROM integration_status WHERE name='google_ads_csv' AND NOT EXISTS(SELECT 1 FROM campaigns WHERE source='csv')",
  );
  await pool().end();
}
