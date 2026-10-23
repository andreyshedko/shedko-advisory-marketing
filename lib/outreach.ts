import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { transaction, type DB } from "./db";
import { audit } from "./audit";
import { ensure, id, text, BusinessError } from "./validation";
import { z } from "zod";
export function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD &&
      process.env.SMTP_FROM &&
      process.env.OUTREACH_FOOTER,
  );
}
export const draftInput = z.object({
  organizationId: id,
  contactId: id,
  parentId: id.optional(),
  subject: text.max(250).optional(),
  body: text.max(15000).optional(),
});
async function eligible(db: DB, organizationId: string, contactId: string) {
  const {
    rows: [row],
  } = await db.query(
    `SELECT c.*,o.name AS organization,o.relevance,o.demo,o.status AS organization_status FROM contacts c JOIN organizations o ON o.id=c.organization_id WHERE c.id=$1 AND o.id=$2 FOR UPDATE OF c,o`,
    [contactId, organizationId],
  );
  ensure(row, "Contact not found");
  ensure(!row.demo, "Demo records cannot be used for email outreach");
  ensure(row.verified_at, "Verify the public contact evidence first");
  ensure(
    !row.do_not_contact && row.organization_status !== "do_not_contact",
    "Organization or contact opted out",
  );
  ensure(
    !(await db.query("SELECT 1 FROM suppressions WHERE email=$1", [row.email]))
      .rowCount,
    "Recipient opted out",
  );
  return row;
}
async function checkFollowup(
  db: DB,
  parentId: string,
  contactId: string,
  organizationId: string,
) {
  const {
    rows: [parent],
  } = await db.query("SELECT * FROM outreach_messages WHERE id=$1", [parentId]);
  ensure(
    parent &&
      parent.status === "sent" &&
      !parent.parent_id &&
      parent.contact_id === contactId &&
      parent.organization_id === organizationId,
    "Follow-up requires the sent initial message for this contact",
  );
  ensure(
    Date.now() - new Date(parent.sent_at).getTime() >= 7 * 86400000,
    "Wait at least seven days before one follow-up",
  );
  ensure(
    !(
      await db.query(
        `SELECT 1 FROM outreach_events e JOIN outreach_messages m ON m.id=e.message_id WHERE m.organization_id=$1 AND e.kind IN ('reply','positive_reply','opt_out')`,
        [organizationId],
      )
    ).rowCount,
    "A reply or opt-out blocks a follow-up",
  );
}
export async function draftMessage(input: unknown, actor: string) {
  const v = draftInput.parse(input);
  return transaction(async (db) => {
    const c = await eligible(db, v.organizationId, v.contactId);
    if (v.parentId)
      await checkFollowup(db, v.parentId, v.contactId, v.organizationId);
    const messageId = randomUUID();
    const subject =
      v.subject ||
      (v.parentId ? "Following up: " : "") +
        `Technical due diligence support for ${c.organization}`;
    const body =
      v.body ||
      `Hello ${c.name || "team"},\n\n${c.relevance}\n\nShedko Advisory provides independent technology and technical due diligence for investors, technology acquirers and M&A advisers. Would independent technical diligence support be relevant to your current deal work?\n\nIf useful, I can share our scope and approach. If this is not relevant, please reply and I will not contact you again.\n\nShedko Advisory\nhttps://shedkoadvisory.com`;
    await db.query(
      "INSERT INTO outreach_messages(id,organization_id,contact_id,recipient,subject,body,parent_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        messageId,
        v.organizationId,
        v.contactId,
        c.email,
        subject,
        body,
        v.parentId || null,
      ],
    );
    await audit(db, actor, "message.drafted", messageId, {
      followup: Boolean(v.parentId),
    });
    return { id: messageId };
  });
}
export async function editMessage(
  messageId: string,
  subject: string,
  body: string,
  actor: string,
) {
  id.parse(messageId);
  text.max(250).parse(subject);
  text.max(15000).parse(body);
  return transaction(async (db) => {
    const r = await db.query(
      `UPDATE outreach_messages SET subject=$2,body=$3,revision=revision+1,status='draft',approved_at=NULL WHERE id=$1 AND status IN ('draft','approved') RETURNING id`,
      [messageId, subject, body],
    );
    ensure(r.rowCount, "Only drafts and approved messages can be edited");
    await audit(db, actor, "message.edited_approval_reset", messageId);
    return { id: messageId };
  });
}
export async function approveMessage(
  messageId: string,
  actor: string,
  confirmed: boolean,
  expectedRevision = 1,
) {
  id.parse(messageId);
  ensure(
    confirmed,
    "Confirm recipient, evidence, relevance and permission to contact",
  );
  return transaction(async (db) => {
    const {
      rows: [m],
    } = await db.query(
      "SELECT * FROM outreach_messages WHERE id=$1 FOR UPDATE",
      [messageId],
    );
    ensure(m?.status === "draft", "Only a draft can be approved");
    ensure(
      m.revision === expectedRevision,
      "Message changed in another window. Reload and review the saved text.",
    );
    await eligible(db, m.organization_id, m.contact_id);
    if (m.parent_id)
      await checkFollowup(db, m.parent_id, m.contact_id, m.organization_id);
    await db.query(
      "UPDATE outreach_messages SET status='approved',approved_at=now() WHERE id=$1",
      [messageId],
    );
    await db.query(
      "INSERT INTO outreach_events(id,message_id,kind,detail) VALUES($1,$2,'approved',$3)",
      [randomUUID(), messageId, actor],
    );
    await audit(db, actor, "message.approved", messageId, {
      revision: m.revision,
    });
    return { id: messageId };
  });
}
export type Delivery = (mail: {
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
}) => Promise<void>;
const smtpDelivery: Delivery = async (mail) => {
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 25000,
    logger: false,
    debug: false,
  });
  try {
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM,
      ...mail,
      headers: { "X-Shedko-Manual-Approval": "true" },
    });
    ensure(
      info.accepted?.some(
        (v: string | { address: string }) =>
          (typeof v === "string" ? v : v.address).toLowerCase() ===
          mail.to.toLowerCase(),
      ),
      "SMTP did not accept recipient",
    );
  } finally {
    transport.close();
  }
};
export async function sendMessage(
  messageId: string,
  actor: string,
  confirmed: boolean,
  deliver: Delivery = smtpDelivery,
  expectedRevision = 1,
) {
  id.parse(messageId);
  ensure(confirmed, "Explicit send confirmation is required");
  ensure(
    smtpConfigured(),
    "SMTP is not connected. Configure corporate SMTP and outreach footer; no email was sent.",
  );
  const m = await transaction(async (db) => {
    const {
      rows: [m],
    } = await db.query(
      "SELECT * FROM outreach_messages WHERE id=$1 FOR UPDATE",
      [messageId],
    );
    ensure(
      m?.status === "approved",
      "Only approved, never attempted messages can be sent",
    );
    ensure(
      m.revision === expectedRevision,
      "Message changed in another window. Reload and review the saved text.",
    );
    await eligible(db, m.organization_id, m.contact_id);
    if (m.parent_id)
      await checkFollowup(db, m.parent_id, m.contact_id, m.organization_id);
    const messageDomain =
      process.env.SMTP_FROM?.match(/@([^>\s]+)/)?.[1] || "shedkoadvisory.com";
    m.smtp_message_id = `<${m.id}@${messageDomain}>`;
    if (m.parent_id)
      m.reply_to = (
        await db.query(
          "SELECT smtp_message_id FROM outreach_messages WHERE id=$1",
          [m.parent_id],
        )
      ).rows[0]?.smtp_message_id;
    await db.query(
      "UPDATE outreach_messages SET status='sending',send_started_at=now(),smtp_message_id=$2 WHERE id=$1",
      [messageId, m.smtp_message_id],
    );
    await audit(db, actor, "message.send_claimed", messageId, {
      revision: m.revision,
    });
    return m;
  });
  try {
    await deliver({
      to: m.recipient,
      subject: m.subject,
      text: `${m.body}\n\n${process.env.OUTREACH_FOOTER}`,
      messageId: m.smtp_message_id,
      ...(m.reply_to ? { inReplyTo: m.reply_to } : {}),
    });
  } catch {
    // Network loss can happen after SMTP acceptance. Never automatically retry an attempted delivery.
    await transaction(async (db) => {
      await db.query(
        "UPDATE outreach_messages SET status='uncertain',last_error='Delivery outcome is uncertain; verify corporate Sent folder before manual resolution.' WHERE id=$1",
        [messageId],
      );
      await db.query(
        "INSERT INTO outreach_events(id,message_id,kind,detail) VALUES($1,$2,'uncertain','SMTP attempt failed or timed out; automatic retry blocked')",
        [randomUUID(), messageId],
      );
      await audit(db, actor, "message.delivery_uncertain", messageId);
    });
    throw new BusinessError(
      "Delivery is uncertain. Automatic resend is blocked; check your corporate mailbox.",
    );
  }
  // If this write fails, the durable 'sending' state prevents a duplicate send.
  await transaction(async (db) => {
    await db.query(
      "UPDATE outreach_messages SET status='sent',sent_at=now() WHERE id=$1",
      [messageId],
    );
    await db.query(
      "UPDATE organizations SET status='contacted' WHERE id=$1 AND status NOT IN ('do_not_contact','replied')",
      [m.organization_id],
    );
    await db.query(
      "INSERT INTO outreach_events(id,message_id,kind,detail) VALUES($1,$2,'smtp_accepted','SMTP accepted the message; delivery is not guaranteed')",
      [randomUUID(), messageId],
    );
    await audit(db, actor, "message.smtp_accepted", messageId);
  });
  return { id: messageId, status: "sent" };
}
export async function recordReply(
  messageId: string,
  kind: "reply" | "positive_reply" | "opt_out",
  detail: string,
  actor: string,
) {
  id.parse(messageId);
  text.parse(detail);
  return transaction(async (db) => {
    const {
      rows: [m],
    } = await db.query(
      "SELECT * FROM outreach_messages WHERE id=$1 FOR UPDATE",
      [messageId],
    );
    ensure(m, "Message not found");
    ensure(
      ["sent", "uncertain", "sending"].includes(m.status),
      "Record a reply against an attempted message",
    );
    await db.query(
      "INSERT INTO outreach_events(id,message_id,kind,detail) VALUES($1,$2,$3,$4)",
      [randomUUID(), messageId, kind, detail],
    );
    if (kind === "opt_out") {
      await db.query(
        "INSERT INTO suppressions(email,reason) VALUES($1,$2) ON CONFLICT(email) DO NOTHING",
        [m.recipient, detail],
      );
      await db.query("UPDATE contacts SET do_not_contact=true WHERE email=$1", [
        m.recipient,
      ]);
      await db.query(
        "UPDATE organizations SET status='do_not_contact' WHERE id=$1",
        [m.organization_id],
      );
      await db.query(
        "UPDATE outreach_messages SET status='cancelled' WHERE organization_id=$1 AND status IN ('draft','approved')",
        [m.organization_id],
      );
    } else
      await db.query(
        "UPDATE organizations SET status='replied' WHERE id=$1 AND status<>'do_not_contact'",
        [m.organization_id],
      );
    await db.query(
      "UPDATE tasks SET status='cancelled' WHERE organization_id=$1 AND kind='followup' AND status='open'",
      [m.organization_id],
    );
    await audit(db, actor, `message.${kind}`, messageId);
    return { id: messageId };
  });
}
export async function scheduleFollowup(
  messageId: string,
  dueAt: string,
  actor: string,
) {
  id.parse(messageId);
  z.iso.datetime({ offset: true }).parse(dueAt);
  return transaction(async (db) => {
    const {
      rows: [m],
    } = await db.query(
      "SELECT * FROM outreach_messages WHERE id=$1 FOR UPDATE",
      [messageId],
    );
    ensure(
      m?.status === "sent" && !m.parent_id,
      "Schedule one follow-up for an initial sent message",
    );
    await eligible(db, m.organization_id, m.contact_id);
    ensure(
      new Date(dueAt).getTime() >= new Date(m.sent_at).getTime() + 7 * 86400000,
      "Follow-up must be at least seven days after initial send",
    );
    ensure(
      new Date(dueAt).getTime() > Date.now(),
      "Choose a future follow-up date",
    );
    ensure(
      !(
        await db.query(
          `SELECT 1 FROM outreach_events e JOIN outreach_messages x ON x.id=e.message_id WHERE x.organization_id=$1 AND e.kind IN ('reply','positive_reply','opt_out')`,
          [m.organization_id],
        )
      ).rowCount,
      "Reply already received",
    );
    await db.query(
      `INSERT INTO tasks(id,organization_id,message_id,title,due_at,kind,dedupe_key) VALUES($1,$2,$3,'Review one relevant follow-up',$4,'followup',$5) ON CONFLICT(dedupe_key) DO UPDATE SET due_at=EXCLUDED.due_at WHERE tasks.status='open'`,
      [
        randomUUID(),
        m.organization_id,
        messageId,
        dueAt,
        `followup:${messageId}`,
      ],
    );
    await audit(db, actor, "followup.scheduled", messageId, { dueAt });
    return { id: messageId };
  });
}
export async function resolveDelivery(
  messageId: string,
  delivered: boolean,
  note: string,
  actor: string,
) {
  id.parse(messageId);
  text.parse(note);
  return transaction(async (db) => {
    const r = await db.query(
      `UPDATE outreach_messages SET status=$2,sent_at=CASE WHEN $2='sent' THEN COALESCE(sent_at,send_started_at) ELSE sent_at END,last_error=$3 WHERE id=$1 AND status IN ('sending','uncertain') RETURNING id`,
      [messageId, delivered ? "sent" : "cancelled", note],
    );
    ensure(r.rowCount, "Only uncertain deliveries can be resolved");
    await db.query(
      "INSERT INTO outreach_events(id,message_id,kind,detail) VALUES($1,$2,'manual_resolution',$3)",
      [randomUUID(), messageId, note],
    );
    await audit(db, actor, "message.manually_resolved", messageId, {
      delivered,
    });
    return { id: messageId };
  });
}
