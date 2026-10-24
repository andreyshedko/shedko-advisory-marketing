import { describe, expect, it } from "vitest";
import { pool } from "../lib/db";
import { operate } from "../lib/operations";
import { draftMessage, recordReply } from "../lib/outreach";
import {
  imapConfigured,
  ingestImapReply,
  parseReplyHeaders,
} from "../lib/imap";

const actor = "imap-test";
const ownAddress = "andrey@shedkoadvisory.example";

async function fixture(status = "sent", suffix = "") {
  const website = `https://imap-acquirer.example${suffix}.com`;
  const org = (await operate(
    {
      action: "organization.create",
      data: {
        name: `Example IMAP Acquirer ${suffix}`,
        website,
        country: "United Kingdom",
        kind: "acquirer",
        relevance: "Test fixture for inbound reply matching.",
        sourceUrl: `${website}/about`,
        sourceNote: "Synthetic test evidence.",
        verified: true,
      },
    },
    actor,
  )) as { id: string };
  const contact = (await operate(
    {
      action: "contact.create",
      data: {
        organizationId: org.id,
        name: "Example contact",
        role: "M&A",
        email: "deals@example.com",
        evidenceUrl: `${website}/contact`,
        verified: true,
      },
    },
    actor,
  )) as { id: string };
  const message = await draftMessage(
    { organizationId: org.id, contactId: contact.id },
    actor,
  );
  const smtpMessageId = `<${message.id}@shedkoadvisory.example>`;
  await pool().query(
    `UPDATE outreach_messages SET status=$2,smtp_message_id=$3,
      send_started_at=CASE WHEN $2 IN ('sent','sending','uncertain') THEN now() ELSE NULL END,
      sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END WHERE id=$1`,
    [message.id, status, smtpMessageId],
  );
  return { org, contact, message, smtpMessageId };
}

function incoming(smtpMessageId: string, overrides = {}) {
  return {
    accountKey: "synthetic-account",
    mailboxKey: "synthetic-account:INBOX",
    uidValidity: "42",
    uid: 101,
    from: "deals@example.com",
    threadIds: [smtpMessageId],
    internetMessageId: "<incoming-101@example.com>",
    subject: "Re: Technical due diligence",
    text: "Thank you, we have a question about your scope.",
    receivedAt: "2026-10-24T09:00:00.000Z",
    ...overrides,
  };
}

async function events(kind = "reply") {
  return (
    await pool().query(
      "SELECT * FROM outreach_events WHERE kind=$1 ORDER BY created_at",
      [kind],
    )
  ).rows;
}

function rawHeaders(headers: string[], body = "A synthetic reply.") {
  const defaults = [
    "From: Example Contact <DEALS@EXAMPLE.COM>",
    `To: ${ownAddress}`,
    "Subject: Re: Technical due diligence",
    "Message-ID: <incoming@example.com>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ].filter(
    (line) =>
      !headers.some((header) =>
        header.toLowerCase().startsWith(line.split(":", 1)[0].toLowerCase() + ":"),
      ),
  );
  return Buffer.from(
    [
      ...defaults,
      ...headers,
      "",
      body,
    ].join("\r\n"),
  );
}

describe("IMAP reply ingestion on real PostgreSQL", () => {
  it("imports a matching reply, cancels an open followup and keeps delivery state", async () => {
    const { org, message, smtpMessageId } = await fixture();
    await pool().query(
      `INSERT INTO tasks(id,organization_id,message_id,title,kind,dedupe_key,due_at)
       VALUES(gen_random_uuid(),$1,$2,'Review followup','followup',$3,now()+interval '8 days')`,
      [org.id, message.id, `followup:${message.id}`],
    );

    expect(await ingestImapReply(incoming(smtpMessageId), actor)).toEqual({
      matched: true,
      imported: true,
    });
    const replies = await events();
    expect(replies).toHaveLength(1);
    expect(replies[0].message_id).toBe(message.id);
    expect(replies[0].detail).toContain("we have a question about your scope");
    expect(
      (await pool().query("SELECT status FROM organizations WHERE id=$1", [org.id]))
        .rows[0].status,
    ).toBe("replied");
    expect(
      (await pool().query("SELECT status FROM outreach_messages WHERE id=$1", [message.id]))
        .rows[0].status,
    ).toBe("sent");
    expect((await pool().query("SELECT status FROM tasks")).rows[0].status).toBe(
      "cancelled",
    );
    expect((await pool().query("SELECT 1 FROM suppressions")).rowCount).toBe(0);
    expect(await events("positive_reply")).toHaveLength(0);
    expect(await events("opt_out")).toHaveLength(0);
  });

  it("records an incoming UID and Message-ID once across repeats and concurrency", async () => {
    const { smtpMessageId } = await fixture();
    const input = incoming(smtpMessageId);
    const results = await Promise.all([
      ingestImapReply(input, actor),
      ingestImapReply(input, actor),
    ]);
    expect(results.filter((r) => r.imported)).toHaveLength(1);
    expect((await ingestImapReply(input, actor)).imported).toBe(false);
    expect(
      (
        await ingestImapReply(
          { ...input, internetMessageId: "<different-message@example.com>" },
          actor,
        )
      ).imported,
    ).toBe(false);
    expect(
      (await ingestImapReply({ ...input, uid: 102 }, actor)).imported,
    ).toBe(false);
    expect(
      (
        await ingestImapReply(
          { ...input, mailboxKey: "synthetic-account:Archive", uid: 1 },
          actor,
        )
      ).imported,
    ).toBe(false);
    expect(await events()).toHaveLength(1);
  });

  it("deduplicates an identical UID without a Message-ID, but respects UIDVALIDITY", async () => {
    const { smtpMessageId } = await fixture();
    const input = incoming(smtpMessageId, { internetMessageId: undefined });
    expect((await ingestImapReply(input, actor)).imported).toBe(true);
    expect((await ingestImapReply(input, actor)).imported).toBe(false);
    expect(
      (await ingestImapReply({ ...input, uidValidity: "43" }, actor)).imported,
    ).toBe(true);
    expect(await events()).toHaveLength(2);
  });

  it("requires both the outgoing thread and the exact recipient address", async () => {
    const { smtpMessageId } = await fixture();
    expect(
      (await ingestImapReply(incoming(smtpMessageId, { from: "other@example.com" }), actor))
        .imported,
    ).toBe(false);
    expect(
      (await ingestImapReply(incoming("<unrelated@example.com>", { uid: 102 }), actor))
        .imported,
    ).toBe(false);
    expect(
      (await ingestImapReply(incoming(smtpMessageId, { threadIds: [], uid: 103 }), actor))
        .imported,
    ).toBe(false);
    expect(await events()).toHaveLength(0);
    expect(
      (
        await ingestImapReply(
          incoming(smtpMessageId, { from: "DEALS@EXAMPLE.COM", uid: 104 }),
          actor,
        )
      ).imported,
    ).toBe(true);
  });

  it.each(["draft", "approved", "cancelled"])(
    "does not import replies against %s messages",
    async (status) => {
      const { smtpMessageId } = await fixture(status);
      expect(
        (await ingestImapReply(incoming(smtpMessageId), actor)).imported,
      ).toBe(false);
      expect(await events()).toHaveLength(0);
    },
  );

  it("skips ambiguous threads referencing messages for different organizations", async () => {
    const first = await fixture();
    const second = await fixture("sent", "2");
    expect(
      await ingestImapReply(
        incoming(first.smtpMessageId, {
          threadIds: [first.smtpMessageId, second.smtpMessageId],
        }),
        actor,
      ),
    ).toEqual({ matched: false, imported: false });
    expect(await events()).toHaveLength(0);
  });

  it.each(["uncertain", "sending"])(
    "recognizes replies against attempted %s messages without resolving delivery",
    async (status) => {
      const { smtpMessageId, message } = await fixture(status);
      expect(
        (await ingestImapReply(incoming(smtpMessageId), actor)).imported,
      ).toBe(true);
      expect(
        (await pool().query("SELECT status FROM outreach_messages WHERE id=$1", [message.id]))
          .rows[0].status,
      ).toBe(status);
    },
  );

  it("skips automated messages and never classifies ordinary reply text as an opt-out", async () => {
    const { smtpMessageId } = await fixture();
    expect(
      (await ingestImapReply(incoming(smtpMessageId, { automated: true }), actor))
        .imported,
    ).toBe(false);
    expect(await events()).toHaveLength(0);
    expect(
      (
        await ingestImapReply(
          incoming(smtpMessageId, { uid: 102, text: "Do not contact us again." }),
          actor,
        )
      ).imported,
    ).toBe(true);
    expect(await events()).toHaveLength(1);
    expect(await events("opt_out")).toHaveLength(0);
    expect((await pool().query("SELECT 1 FROM suppressions")).rowCount).toBe(0);
  });

  it("preserves an existing opt-out and bounds stored incoming text", async () => {
    const { org, message, smtpMessageId } = await fixture();
    await recordReply(message.id, "opt_out", "Manual opt-out", actor);
    expect(
      (
        await ingestImapReply(
          incoming(smtpMessageId, { text: "x".repeat(12000) }),
          actor,
        )
      ).imported,
    ).toBe(true);
    const replies = await events();
    expect(replies).toHaveLength(1);
    expect(replies[0].detail.length).toBeLessThanOrEqual(5000);
    expect(
      (await pool().query("SELECT status FROM organizations WHERE id=$1", [org.id]))
        .rows[0].status,
    ).toBe("do_not_contact");
    expect((await pool().query("SELECT 1 FROM suppressions")).rowCount).toBe(1);
  });
});

describe("safe IMAP headers", () => {
  it("uses direct In-Reply-To before older References and deduplicates thread IDs", async () => {
    const parsed = await parseReplyHeaders(
      rawHeaders([
        "In-Reply-To: <followup@shedkoadvisory.example>",
        "References: <initial@shedkoadvisory.example>",
        " <followup@shedkoadvisory.example>",
      ]),
      ownAddress,
    );
    expect(parsed.from).toBe("deals@example.com");
    expect(parsed.internetMessageId).toBe("<incoming@example.com>");
    expect(parsed.automated).toBe(false);
    expect(parsed.threadIds).toEqual([
      "<followup@shedkoadvisory.example>",
      "<initial@shedkoadvisory.example>",
    ]);
  });

  it.each([
    ["Auto-Submitted: auto-replied"],
    ["Auto-Submitted: auto-generated"],
    ["Content-Type: multipart/report; report-type=delivery-status; boundary=report"],
    ["From: Mail Delivery System <mailer-daemon@example.com>"],
    [`From: ${ownAddress}`],
    ["From: one@example.com, two@example.com"],
  ])("flags automated, own and ambiguous senders: %s", async (...header) => {
    const parsed = await parseReplyHeaders(rawHeaders(header), ownAddress);
    expect(parsed.automated).toBe(true);
  });

  it("allows an explicit Auto-Submitted: no", async () => {
    const parsed = await parseReplyHeaders(
      rawHeaders(["Auto-Submitted: no"]),
      ownAddress,
    );
    expect(parsed.automated).toBe(false);
  });

  it("requires a complete IMAP configuration", () => {
    expect(imapConfigured()).toBe(false);
    Object.assign(process.env, {
      IMAP_HOST: "imap.porkbun.com",
      IMAP_PORT: "993",
      IMAP_USER: ownAddress,
      IMAP_PASSWORD: "synthetic-password",
    });
    expect(imapConfigured()).toBe(true);
    delete process.env.IMAP_PASSWORD;
    expect(imapConfigured()).toBe(false);
  });
});
