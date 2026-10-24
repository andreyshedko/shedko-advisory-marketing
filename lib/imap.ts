import { createHash, randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import PostalMime, { addressParser } from "postal-mime";
import { z } from "zod";
import { pool, transaction, type DB } from "./db";
import { audit } from "./audit";
import { BusinessError, ensure } from "./validation";

const MAX_SOURCE = 512 * 1024;
const MAX_HEADERS = 64 * 1024;
const MAX_MESSAGES = 50;
const parserOptions = {
  maxNestingDepth: 20,
  maxHeadersSize: MAX_HEADERS,
  maxPartCount: 200,
  maxRfc822NestingDepth: 0,
  maxForwardedAddresses: 100,
  forceRfc822Attachments: true,
};
function configuration() {
  return {
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    user: process.env.IMAP_USER || process.env.SMTP_USER,
    pass: process.env.IMAP_PASSWORD || process.env.SMTP_PASSWORD,
    mailbox: process.env.IMAP_MAILBOX || "INBOX",
  };
}
export function imapConfigured() {
  const c = configuration();
  return Boolean(c.host && c.user && c.pass && Number.isInteger(c.port) && c.port > 0 && c.port <= 65535);
}
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
const ids = (s = "") => (s.match(/<[^<>\s]{1,998}>/g) || []).slice(0, 100);
export type ReplyHeaders = {
  from: string;
  threadIds: string[];
  internetMessageId?: string;
  subject: string;
  automated: boolean;
};
export async function parseReplyHeaders(source: Uint8Array, ownAddress: string): Promise<ReplyHeaders> {
  ensure(source.byteLength <= MAX_HEADERS, "Incoming headers exceed the limit");
  const email = await PostalMime.parse(source, parserOptions);
  const header = (name: string) => email.headers.filter(h => h.key === name).map(h => h.value).join(" ");
  const senders = addressParser(header("from"), { flatten: true });
  const sender = senders[0];
  const from = senders.length === 1 && sender && "address" in sender ? (sender.address || "").toLowerCase() : "";
  const auto = header("auto-submitted").trim().toLowerCase();
  return {
    from,
    threadIds: [...new Set([...ids(email.inReplyTo), ...ids(email.references).reverse()])],
    internetMessageId: ids(email.messageId)[0],
    subject: clean(email.subject || "Без темы").slice(0, 500),
    automated: !from || from === ownAddress.toLowerCase() ||
      (auto !== "" && auto !== "no") || /^(bulk|list|junk)$/i.test(header("precedence").trim()) ||
      /multipart\/report/i.test(header("content-type")) || header("return-path").trim() === "<>" ||
      Boolean(header("x-autoreply") || header("x-autorespond")) || /^(mailer-daemon|postmaster)@/i.test(from),
  };
}
const incomingSchema = z.object({
  accountKey: z.string().min(1).max(128), mailboxKey: z.string().min(1).max(128),
  uidValidity: z.string().regex(/^\d{1,30}$/), uid: z.number().int().min(1).max(4294967295),
  from: z.string().max(500), threadIds: z.array(z.string().max(1000)).max(100),
  internetMessageId: z.string().max(1000).optional(), subject: z.string().max(500),
  text: z.string().max(MAX_SOURCE), receivedAt: z.iso.datetime({ offset: true }).optional(),
  automated: z.boolean().optional(),
});
export type IncomingReply = z.infer<typeof incomingSchema>;
async function findMessage(db: DB, input: Pick<IncomingReply, "from" | "threadIds" | "automated">) {
  if (input.automated || !input.from || !input.threadIds.length) return null;
  const { rows } = await db.query(
    "SELECT id,organization_id,smtp_message_id FROM outreach_messages WHERE smtp_message_id=ANY($1::text[]) AND lower(recipient)=$2 AND status IN ('sent','uncertain','sending')",
    [input.threadIds, input.from.toLowerCase()],
  );
  if (!rows.length || new Set(rows.map(r => r.organization_id)).size !== 1) return null;
  rows.sort((a, b) => input.threadIds.indexOf(a.smtp_message_id) - input.threadIds.indexOf(b.smtp_message_id));
  return rows[0];
}
export async function ingestImapReply(input: IncomingReply, actor: string) {
  const v = incomingSchema.parse(input);
  return transaction(async db => {
    const candidate = await findMessage(db, v);
    if (!candidate) return { matched: false, imported: false };
    const { rows: [message] } = await db.query(
      "SELECT id,organization_id,status FROM outreach_messages WHERE id=$1 FOR UPDATE", [candidate.id],
    );
    if (!message || !["sent", "uncertain", "sending"].includes(message.status)) return { matched: false, imported: false };
    await db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [message.organization_id]);
    const receiptId = randomUUID();
    const claimed = await db.query(
      "INSERT INTO imap_receipts(id,account_key,mailbox_key,uid_validity,uid,internet_message_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id",
      [receiptId, v.accountKey, v.mailboxKey, v.uidValidity, v.uid, v.internetMessageId || null],
    );
    if (!claimed.rowCount) return { matched: true, imported: false };
    const eventId = randomUUID();
    const detail = clean(`IMAP · ${v.from}\n${v.subject}\n${v.receivedAt || ""}\n\n${v.text || "Текст письма недоступен; проверьте корпоративный ящик."}`).slice(0, 5000);
    await db.query(
      "INSERT INTO outreach_events(id,message_id,kind,detail,external_id,created_at) VALUES($1,$2,'reply',$3,$4,COALESCE($5::timestamptz,now()))",
      [eventId, message.id, detail, `imap:${receiptId}`, v.receivedAt || null],
    );
    await db.query("UPDATE imap_receipts SET event_id=$2 WHERE id=$1", [receiptId, eventId]);
    await db.query("UPDATE organizations SET status='replied' WHERE id=$1 AND status<>'do_not_contact'", [message.organization_id]);
    await db.query("UPDATE tasks SET status='cancelled' WHERE organization_id=$1 AND kind='followup' AND status='open'", [message.organization_id]);
    await audit(db, actor, "message.imap_reply", message.id, { receiptId });
    return { matched: true, imported: true };
  });
}
export type ImapSyncResult = { scanned: number; matched: number; imported: number; skipped: number; hasMore: boolean; throttled?: boolean };
const emptyResult = (): ImapSyncResult => ({ scanned: 0, matched: 0, imported: 0, skipped: 0, hasMore: false });
const fingerprint = (s: string) => createHash("sha256").update(s).digest("hex");
function plainHtml(html: string) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?\s*>|<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
}
export async function syncImapReplies(actor = "imap", force = true): Promise<ImapSyncResult> {
  ensure(imapConfigured(), "Настройте IMAP_HOST и учётные данные корпоративного ящика");
  const c = configuration();
  const guard = await pool().connect();
  let locked = false;
  let inTransaction = false;
  let client: ImapFlow | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await guard.query("BEGIN");
    inTransaction = true;
    locked = (await guard.query("SELECT pg_try_advisory_xact_lock(8734623) AS locked")).rows[0].locked;
    if (!locked) return { ...emptyResult(), throttled: true };
    if (!force && (await guard.query("SELECT 1 FROM integration_status WHERE name='porkbun_imap' AND updated_at>now()-interval '5 minutes' AND status<>'failed'")).rowCount)
      return { ...emptyResult(), throttled: true };
    await guard.query("INSERT INTO integration_status(name,status,detail) VALUES('porkbun_imap','syncing','Проверка входящих ответов') ON CONFLICT(name) DO UPDATE SET status='syncing',detail=EXCLUDED.detail,updated_at=now()");
    const accountKey = fingerprint(`${c.host}:${c.port}:${c.user!.toLowerCase()}`);
    const mailboxKey = fingerprint(`${accountKey}:${c.mailbox}`);
    client = new ImapFlow({ host: c.host!, port: c.port, secure: true, auth: { user: c.user!, pass: c.pass! }, logger: false,
      disableAutoIdle: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 12000 });
    client.on("error", () => { /* Provider diagnostics must not expose mailbox credentials. */ });
    const deadline = Date.now() + 35000;
    timer = setTimeout(() => client?.close(), 35000);
    await client.connect();
    ensure(client.secureConnection, "IMAP requires a verified TLS connection");
    const lock = await client.getMailboxLock(c.mailbox, { readOnly: true });
    try {
      const box = client.mailbox;
      ensure(box, "IMAP mailbox is not open");
      const uidValidity = String(box.uidValidity);
      const upper = box.uidNext - 1;
      const { rows: [cursor] } = await guard.query("SELECT uid_validity,last_uid FROM imap_cursors WHERE mailbox_key=$1", [mailboxKey]);
      const resumed = cursor?.uid_validity === uidValidity;
      let last = resumed ? Number(cursor.last_uid) : 0;
      let uids: number[] = [];
      const attempts = (await guard.query("SELECT 1 FROM outreach_messages WHERE smtp_message_id IS NOT NULL AND status IN ('sent','uncertain','sending') LIMIT 1")).rowCount;
      if (!attempts) last = Math.max(last, upper);
      if (upper > last) {
        const found = await client.search({ uid: `${last + 1}:${upper}`, ...(!resumed ? { since: new Date(Date.now() - 30 * 86400000) } : {}) }, { uid: true });
        uids = (found || []).filter(uid => uid > last && uid <= upper).sort((a, b) => a - b);
      }
      if (!resumed) last = uids.length ? uids[0] - 1 : upper;
      const saveCursor = () => guard.query("INSERT INTO imap_cursors(mailbox_key,uid_validity,last_uid) VALUES($1,$2,$3) ON CONFLICT(mailbox_key) DO UPDATE SET uid_validity=EXCLUDED.uid_validity,last_uid=EXCLUDED.last_uid,updated_at=now()", [mailboxKey, uidValidity, last]);
      await saveCursor();
      const result = emptyResult();
      for (const uid of uids.slice(0, MAX_MESSAGES)) {
        if (Date.now() > deadline - 3000) break;
        const message = await client.fetchOne(uid, { uid: true, size: true, internalDate: true,
          headers: ["message-id", "in-reply-to", "references", "from", "subject", "auto-submitted", "precedence", "content-type", "return-path", "x-autoreply", "x-autorespond"] }, { uid: true });
        result.scanned++;
        let headers: ReplyHeaders | undefined;
        if (message && message.headers && message.headers.byteLength <= MAX_HEADERS) {
          try { headers = await parseReplyHeaders(message.headers, c.user!); } catch { /* Invalid mail headers are not eligible for automatic matching. */ }
        }
        if (headers && await findMessage(guard, headers)) {
          let body = "Текст не загружен: размер письма превышает 512 КиБ. Откройте корпоративный ящик.";
          if (message && message.size && message.size <= MAX_SOURCE) {
            const source = await client.fetchOne(uid, { source: { start: 0, maxLength: MAX_SOURCE } }, { uid: true });
            if (source && source.source) {
              try {
                const parsed = await PostalMime.parse(source.source, parserOptions);
                body = (parsed.text || (parsed.html ? plainHtml(parsed.html) : "Текст отсутствует; откройте корпоративный ящик.")).slice(0, 15000);
              } catch { body = "Не удалось разобрать текст; откройте корпоративный ящик."; }
            }
          }
          const at = message && message.internalDate instanceof Date && Number.isFinite(message.internalDate.getTime()) ? message.internalDate.toISOString() : undefined;
          const imported = await ingestImapReply({ accountKey, mailboxKey, uidValidity, uid, ...headers, text: body, receivedAt: at }, actor);
          if (imported.matched) result.matched++;
          if (imported.imported) result.imported++; else result.skipped++;
        } else result.skipped++;
        last = uid;
        await saveCursor();
      }
      result.hasMore = uids.some(uid => uid > last);
      await guard.query("UPDATE integration_status SET status='connected',last_success_at=now(),updated_at=now(),detail=$1 WHERE name='porkbun_imap'", [`Проверено: ${result.scanned}; новых ответов: ${result.imported}.${result.hasMore ? " Остались письма для следующей проверки." : ""}`]);
      await audit(guard, actor, "mailbox.imap_synced", null, result);
      await guard.query("COMMIT");
      inTransaction = false;
      return result;
    } finally { lock.release(); }
  } catch {
    if (inTransaction) {
      await guard.query("ROLLBACK");
      inTransaction = false;
    }
    if (locked) await guard.query("INSERT INTO integration_status(name,status,detail) VALUES('porkbun_imap','failed','Не удалось проверить IMAP. Проверьте сервер, пароль и доступность ящика.') ON CONFLICT(name) DO UPDATE SET status='failed',updated_at=now(),detail=EXCLUDED.detail");
    throw new BusinessError("Не удалось проверить IMAP. Проверьте настройки корпоративного ящика; письма не изменялись.", 502);
  } finally {
    if (timer) clearTimeout(timer);
    client?.close();
    try { if (inTransaction) await guard.query("ROLLBACK"); }
    finally { guard.release(); }
  }
}
