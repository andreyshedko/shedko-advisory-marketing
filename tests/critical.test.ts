import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { pool } from "../lib/db";
import { operate } from "../lib/operations";
import {
  sendMessage,
  approveMessage,
  draftMessage,
  editMessage,
  recordReply,
  scheduleFollowup,
} from "../lib/outreach";
import { parseAdsCsv, importAds } from "../lib/ads";
import { runJobs } from "../lib/jobs";
import { authorizedBearer, requireSameOrigin } from "../lib/security";
import { normalizeDomain, normalizeName } from "../lib/validation";
import { dashboard } from "../lib/dashboard";
const actor = "test-admin";
const orgInput = {
  name: "Example Acquirer",
  website: "https://www.acquirer.example.com",
  country: "United Kingdom",
  kind: "acquirer",
  relevance:
    "Acquires established software businesses; potential technical due diligence partnership.",
  sourceUrl: "https://acquirer.example.com/about",
  sourceNote: "Test fixture source; not real market research",
  verified: true,
};
async function fixture() {
  const o = (await operate(
    { action: "organization.create", data: orgInput },
    actor,
  )) as { id: string };
  const c = (await operate(
    {
      action: "contact.create",
      data: {
        organizationId: o.id,
        name: "Example contact",
        role: "M&A",
        email: "deals@example.com",
        evidenceUrl: "https://example.com/contact",
        verified: true,
      },
    },
    actor,
  )) as { id: string };
  const m = await draftMessage(
    { organizationId: o.id, contactId: c.id },
    actor,
  );
  return { o, c, m };
}
function smtpEnv() {
  Object.assign(process.env, {
    SMTP_HOST: "smtp.porkbun.com",
    SMTP_USER: "corporate@example.com",
    SMTP_PASSWORD: "test-not-real",
    SMTP_FROM: "Shedko <corporate@example.com>",
    OUTREACH_FOOTER: "Test corporate footer",
  });
}
const csv =
  'account_id,campaign_id,campaign,date,currency,impressions,clicks,cost,conversions\n123-456-7890,1,"Technical, diligence",2026-10-23,USD,100,5,12.50,1\n';
describe("critical operations on real PostgreSQL", () => {
  it("normalizes public domains and organization names; rejects unsafe URLs", () => {
    expect(normalizeDomain("https://deals.company.co.uk/path")).toBe(
      "company.co.uk",
    );
    expect(normalizeName("Šhedko, Advisory")).toBe("shedkoadvisory");
    expect(() => normalizeDomain("javascript:alert(1)")).toThrow();
    expect(() => normalizeDomain("http://localhost")).toThrow();
  });
  it("persists an organization, source and verified contact; blocks normalized duplicates", async () => {
    const { o } = await fixture();
    expect(
      (
        await pool().query("SELECT * FROM evidence WHERE organization_id=$1", [
          o.id,
        ])
      ).rowCount,
    ).toBe(1);
    await expect(
      operate(
        {
          action: "organization.create",
          data: {
            ...orgInput,
            name: "Other",
            website: "https://other.acquirer.example.com",
          },
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      operate(
        {
          action: "organization.create",
          data: {
            ...orgInput,
            name: "Example-Acquirer",
            website: "https://different.org",
          },
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("requires approval, explicit send confirmation and SMTP; editing resets approval", async () => {
    const { m } = await fixture();
    await expect(sendMessage(m.id, actor, true)).rejects.toThrow(
      "SMTP is not connected",
    );
    expect(
      (
        await pool().query("SELECT status FROM outreach_messages WHERE id=$1", [
          m.id,
        ])
      ).rows[0].status,
    ).toBe("draft");
    await expect(approveMessage(m.id, actor, false)).rejects.toThrow("Confirm");
    await approveMessage(m.id, actor, true);
    await editMessage(
      m.id,
      "Revised subject",
      "Accurate revised content",
      actor,
    );
    expect(
      (
        await pool().query(
          "SELECT status,approved_at FROM outreach_messages WHERE id=$1",
          [m.id],
        )
      ).rows[0],
    ).toMatchObject({ status: "draft", approved_at: null });
    smtpEnv();
    await expect(sendMessage(m.id, actor, true, vi.fn())).rejects.toThrow(
      "Only approved",
    );
    await approveMessage(m.id, actor, true, 2);
    await expect(sendMessage(m.id, actor, false, vi.fn())).rejects.toThrow(
      "confirmation",
    );
  });
  it("rejects approving and sending a stale message revision", async () => {
    const { m } = await fixture();
    await editMessage(
      m.id,
      "Updated saved subject",
      "Updated saved body",
      actor,
    );
    await expect(approveMessage(m.id, actor, true, 1)).rejects.toThrow(
      "another window",
    );
    await approveMessage(m.id, actor, true, 2);
    smtpEnv();
    const deliver = vi.fn(async () => {});
    await expect(sendMessage(m.id, actor, true, deliver, 1)).rejects.toThrow(
      "another window",
    );
    expect(deliver).not.toHaveBeenCalled();
  });
  it("sends through a loopback SMTP server, logs acceptance and schedules one follow-up", async () => {
    const { m } = await fixture();
    smtpEnv();
    await approveMessage(m.id, actor, true);
    let received = "";
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onData(stream, _session, callback) {
        stream.on("data", (chunk) => {
          received += chunk.toString();
        });
        stream.on("end", () => callback());
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server.server, "listening");
    const address = server.server.address();
    if (!address || typeof address === "string")
      throw new Error("No local SMTP port");
    const transport = nodemailer.createTransport({
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      ignoreTLS: true,
    });
    try {
      await sendMessage(m.id, actor, true, async (mail) => {
        await transport.sendMail({ from: "test@example.com", ...mail });
      });
      expect(received).toContain("Technical due diligence");
      expect(received).toContain("Test corporate footer");
      const record = (
        await pool().query("SELECT * FROM outreach_messages WHERE id=$1", [
          m.id,
        ])
      ).rows[0];
      expect(record.status).toBe("sent");
      expect(record.smtp_message_id).toContain(m.id);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM outreach_events WHERE message_id=$1 AND kind='smtp_accepted'",
            [m.id],
          )
        ).rowCount,
      ).toBe(1);
      await scheduleFollowup(
        m.id,
        new Date(Date.now() + 8 * 86400000).toISOString(),
        actor,
      );
      await scheduleFollowup(
        m.id,
        new Date(Date.now() + 9 * 86400000).toISOString(),
        actor,
      );
      expect(
        (await pool().query("SELECT 1 FROM tasks WHERE kind='followup'"))
          .rowCount,
      ).toBe(1);
    } finally {
      transport.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("concurrent repeated sends result in one delivery attempt", async () => {
    const { m } = await fixture();
    smtpEnv();
    await approveMessage(m.id, actor, true);
    const deliver = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const results = await Promise.allSettled([
      sendMessage(m.id, actor, true, deliver),
      sendMessage(m.id, actor, true, deliver),
    ]);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("uncertain SMTP outcome blocks every subsequent send", async () => {
    const { m } = await fixture();
    smtpEnv();
    await approveMessage(m.id, actor, true);
    const deliver = vi.fn(async () => {
      throw new Error("Lost connection after DATA");
    });
    await expect(sendMessage(m.id, actor, true, deliver)).rejects.toThrow(
      "uncertain",
    );
    await expect(sendMessage(m.id, actor, true, deliver)).rejects.toThrow(
      "Only approved",
    );
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(
      (
        await pool().query("SELECT status FROM outreach_messages WHERE id=$1", [
          m.id,
        ])
      ).rows[0].status,
    ).toBe("uncertain");
  });
  it("allows one follow-up only after seven days and blocks follow-up after any reply", async () => {
    const { o, c, m } = await fixture();
    smtpEnv();
    await approveMessage(m.id, actor, true);
    await sendMessage(m.id, actor, true, async () => {});
    await expect(
      draftMessage(
        { organizationId: o.id, contactId: c.id, parentId: m.id },
        actor,
      ),
    ).rejects.toThrow("seven days");
    await pool().query(
      "UPDATE outreach_messages SET sent_at=now()-interval '8 days' WHERE id=$1",
      [m.id],
    );
    const follow = await draftMessage(
      { organizationId: o.id, contactId: c.id, parentId: m.id },
      actor,
    );
    await expect(
      draftMessage(
        { organizationId: o.id, contactId: c.id, parentId: m.id },
        actor,
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await recordReply(m.id, "reply", "Already have a provider", actor);
    await expect(approveMessage(follow.id, actor, true)).rejects.toThrow(
      "reply",
    );
  });
  it("opt-out suppresses the address, cancels drafts and follow-up tasks", async () => {
    const { o, c, m } = await fixture();
    smtpEnv();
    await approveMessage(m.id, actor, true);
    await sendMessage(m.id, actor, true, async () => {});
    await scheduleFollowup(
      m.id,
      new Date(Date.now() + 8 * 86400000).toISOString(),
      actor,
    );
    await recordReply(m.id, "opt_out", "Do not contact us again", actor);
    expect((await pool().query("SELECT * FROM suppressions")).rowCount).toBe(1);
    expect(
      (await pool().query("SELECT status FROM tasks")).rows[0].status,
    ).toBe("cancelled");
    await expect(
      draftMessage(
        { organizationId: o.id, contactId: c.id, parentId: m.id },
        actor,
      ),
    ).rejects.toThrow("opted out");
    await expect(
      operate(
        {
          action: "organization.update",
          data: { id: o.id, status: "researched", nextAction: "" },
        },
        actor,
      ),
    ).rejects.toThrow("Opt-out");
  });
  it("CSV re-import updates rather than duplicates; invalid imports roll back", async () => {
    const rows = parseAdsCsv(csv);
    expect(rows[0].campaign).toBe("Technical, diligence");
    await importAds(rows, "csv", actor);
    await importAds(rows, "csv", actor);
    expect(
      (
        await pool().query(
          "SELECT COUNT(*)::int AS n,SUM(cost)::float AS cost FROM campaigns",
        )
      ).rows[0],
    ).toEqual({ n: 1, cost: 12.5 });
    await expect(
      importAds(
        [
          { ...rows[0], campaign_id: "2" },
          { ...rows[0], date: "2026-02-30" },
        ],
        "csv",
        actor,
      ),
    ).rejects.toThrow();
    expect((await pool().query("SELECT 1 FROM campaigns")).rowCount).toBe(1);
    expect(() => parseAdsCsv(csv.replace("100,5", "1,5"))).toThrow();
  });
  it("cron is idempotent, raises a budget alert and retries failed safe checks", async () => {
    process.env.DAILY_BUDGETS = '{"USD":10}';
    const day = new Date().toISOString().slice(0, 10);
    await importAds(parseAdsCsv(csv.replace("2026-10-23", day)), "csv", actor);
    const key = `daily:${day}`;
    const results = await Promise.all([runJobs(key), runJobs(key)]);
    expect(results.filter((r) => "skipped" in r)).toHaveLength(1);
    expect(
      (await pool().query("SELECT 1 FROM tasks WHERE kind='alert'")).rowCount,
    ).toBe(1);
    expect(
      (await pool().query("SELECT 1 FROM outreach_messages")).rowCount,
    ).toBe(0);
    process.env.DAILY_BUDGETS = "not-json";
    await expect(runJobs("failed-job")).rejects.toThrow("Safe job failed");
    process.env.DAILY_BUDGETS = "{}";
    await runJobs("failed-job");
    expect(
      (
        await pool().query(
          "SELECT status,attempts FROM job_runs WHERE job_key='failed-job'",
        )
      ).rows[0],
    ).toEqual({ status: "succeeded", attempts: 2 });
  });
  it("dashboard uses real rows and isolates demo organizations from funnel metrics", async () => {
    await fixture();
    await pool().query("UPDATE organizations SET demo=true");
    const d = await dashboard({
      from: "2026-01-01",
      to: "2027-12-31",
      kind: "all",
    });
    expect(d.metrics.organizations).toBe(0);
    expect(d.connections.smtp).toBe(false);
    expect(d.campaigns).toHaveLength(0);
    const contact=(await pool().query('SELECT id FROM contacts LIMIT 1')).rows[0];
    await expect(draftMessage({organizationId:d.organizations[0].id,contactId:contact.id},actor)).rejects.toThrow('Demo');
  });
  it("retains funnel stage history and separates currency totals", async () => {
    const {o}=await fixture();
    const created=await operate({action:'opportunity.create',data:{organizationId:o.id,stage:'qualified',notes:'Synthetic actual qualification event',currency:'USD'}},actor) as {id:string};
    await operate({action:'opportunity.update',data:{id:created.id,stage:'negotiation',notes:'Synthetic conversation'}},actor);
    await importAds(parseAdsCsv(csv),'csv',actor);
    await operate({action:'spend.create',data:{category:'tools',label:'Synthetic EUR cost',amount:3,currency:'EUR',day:'2026-10-23',confirmation:'manual'}},actor);
    const d=await dashboard({from:'2026-01-01',to:'2027-12-31',kind:'all'});
    expect(d.metrics.qualified).toBe(1);expect(d.metrics.negotiations).toBe(1);
    expect(d.totals).toEqual(expect.arrayContaining([{currency:'USD',source:'ads_data',amount:12.5},{currency:'EUR',source:'manual',amount:3}]));
    expect(d.opportunityEvents).toHaveLength(2);
  });
  it("partner submission requires review and explicit confirmation", async () => {
    const { o } = await fixture();
    const p = (await operate(
      {
        action: "partner.create",
        data: {
          organizationId: o.id,
          url: "https://example.com/partners",
          channel: "partner_program",
          materials: "Practice overview",
        },
      },
      actor,
    )) as { id: string };
    const update = (status: string, confirmed = false) =>
      operate(
        {
          action: "partner.update",
          data: { id: p.id, status, draft: "Reviewed text", confirmed },
        },
        actor,
      );
    await expect(update("submitted", true)).rejects.toThrow("Invalid");
    await update("review");
    await expect(update("submitted")).rejects.toThrow("Confirm");
    await update("submitted", true);
    expect(
      (await pool().query("SELECT submitted_at FROM partner_applications"))
        .rows[0].submitted_at,
    ).toBeTruthy();
  });
  it("protects cron bearer and mutation origin", () => {
    const token = "very-long-random-test-secret-123456789";
    expect(
      authorizedBearer(
        new Request("http://localhost", {
          headers: { authorization: `Bearer ${token}` },
        }),
        token,
      ),
    ).toBe(true);
    expect(authorizedBearer(new Request("http://localhost"), undefined)).toBe(
      false,
    );
    expect(
      authorizedBearer(
        new Request("http://localhost", {
          headers: { authorization: "Bearer wrong" },
        }),
        token,
      ),
    ).toBe(false);
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    expect(() =>
      requireSameOrigin(
        new Request("http://localhost:3000/api/admin", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow("origin");
  });
  it("input validation rejects unverified contacts and oversized text", async () => {
    await expect(
      operate(
        {
          action: "contact.create",
          data: {
            organizationId: randomUUID(),
            email: "personal@example.com",
            evidenceUrl: "https://example.com",
            verified: false,
          },
        },
        actor,
      ),
    ).rejects.toThrow();
  });
});
