import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../lib/db";

const mock = vi.hoisted(() => ({
  construct: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  release: vi.fn(),
  getMailboxLock: vi.fn(),
  search: vi.fn(),
  fetchOne: vi.fn(),
  uidNext: 103,
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    secureConnection = true;
    constructor(options: unknown) { mock.construct(options); }
    get mailbox() { return { uidValidity: 42n, uidNext: mock.uidNext }; }
    connect = mock.connect;
    close = mock.close;
    getMailboxLock = mock.getMailboxLock;
    search = mock.search;
    fetchOne = mock.fetchOne;
    on() { return this; }
  },
}));
import { syncImapReplies } from "../lib/imap";

beforeEach(() => {
  vi.clearAllMocks();
  mock.uidNext = 103;
  mock.connect.mockResolvedValue(undefined);
  mock.getMailboxLock.mockResolvedValue({ release: mock.release });
  Object.assign(process.env, {
    IMAP_HOST: "imap.example.com",
    IMAP_PORT: "993",
    IMAP_USER: "andrey@shedkoadvisory.example",
    IMAP_PASSWORD: "synthetic-password",
    IMAP_MAILBOX: "INBOX",
  });
});

async function sentMessage() {
  const organization = randomUUID(), contact = randomUUID(), message = randomUUID();
  await pool().query(
    `INSERT INTO organizations(id,name,normalized_name,domain,website,country,kind,relevance)
      VALUES($1,'Example','example','example.com','https://example.com','United Kingdom','acquirer','Synthetic fixture')`,
    [organization],
  );
  await pool().query(
    "INSERT INTO contacts(id,organization_id,email,evidence_url) VALUES($1,$2,'deals@example.com','https://example.com/contact')",
    [contact, organization],
  );
  await pool().query(
    `INSERT INTO outreach_messages(id,organization_id,contact_id,recipient,subject,body,status,smtp_message_id,sent_at)
      VALUES($1,$2,$3,'deals@example.com','Synthetic subject','Synthetic outgoing text','sent','<outgoing@shedkoadvisory.example>',now())`,
    [message, organization, contact],
  );
}

function mail(internetId: string, matched = true) {
  const headers = Buffer.from([
    `From: ${matched ? "deals@example.com" : "unrelated@example.com"}`,
    "To: andrey@shedkoadvisory.example",
    `Message-ID: <${internetId}@example.com>`,
    "In-Reply-To: <outgoing@shedkoadvisory.example>",
    "Subject: Synthetic reply",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "",
  ].join("\r\n"));
  return { headers, source: Buffer.concat([headers, Buffer.from("A synthetic response.")]) };
}

function serve(messages: Map<number, ReturnType<typeof mail>>, failureUid?: number) {
  mock.fetchOne.mockImplementation(async (uid: number, query: { source?: unknown }) => {
    if (!query.source && uid === failureUid) throw new Error("Synthetic connection failure");
    const item = messages.get(uid)!;
    return query.source ? { source: item.source } : {
      uid, headers: item.headers, size: item.source.length,
      internalDate: new Date("2026-10-24T09:00:00.000Z"),
    };
  });
}

describe("IMAP synchronization with a simulated mailbox", () => {
  it("opens read only, fetches bodies only for matching threads and resumes its UID cursor", async () => {
    await sentMessage();
    const messages = new Map([[101, mail("unrelated", false)], [102, mail("reply")]]);
    serve(messages);
    mock.search.mockResolvedValueOnce([102, 101]);
    expect(await syncImapReplies("test")).toMatchObject({ scanned: 2, imported: 1, hasMore: false });
    expect(mock.getMailboxLock).toHaveBeenCalledWith("INBOX", { readOnly: true });
    expect(mock.construct).toHaveBeenCalledWith(expect.objectContaining({ secure: true, logger: false }));
    const bodyCalls = mock.fetchOne.mock.calls.filter(([, query]) => query.source);
    expect(bodyCalls.map(([uid]) => uid)).toEqual([102]);
    expect(bodyCalls[0][1]).toEqual({ source: { start: 0, maxLength: 512 * 1024 } });
    expect((await pool().query("SELECT last_uid FROM imap_cursors")).rows[0].last_uid).toBe("102");

    mock.uidNext = 104;
    messages.set(103, mail("reply"));
    mock.search.mockResolvedValueOnce([103]);
    expect(await syncImapReplies("test")).toMatchObject({ scanned: 1, imported: 0, hasMore: false });
    expect(mock.search).toHaveBeenLastCalledWith({ uid: "103:103" }, { uid: true });
    expect((await pool().query("SELECT 1 FROM outreach_events WHERE kind='reply'")).rowCount).toBe(1);
    expect((await pool().query("SELECT last_uid FROM imap_cursors")).rows[0].last_uid).toBe("103");
    expect(await syncImapReplies("test", false)).toMatchObject({ throttled: true });
    expect(mock.connect).toHaveBeenCalledTimes(2);
    expect(mock.release).toHaveBeenCalledTimes(2);
    expect(mock.close).toHaveBeenCalledTimes(2);
  });

  it("rolls back a failed scan cursor and safely deduplicates committed replies on retry", async () => {
    await sentMessage();
    const messages = new Map([[101, mail("first")], [102, mail("second")]]);
    serve(messages, 102);
    mock.search.mockResolvedValue([101, 102]);
    await expect(syncImapReplies("test")).rejects.toThrow("Не удалось проверить IMAP");
    expect((await pool().query("SELECT 1 FROM imap_cursors")).rowCount).toBe(0);
    expect((await pool().query("SELECT 1 FROM outreach_events WHERE kind='reply'")).rowCount).toBe(1);
    expect((await pool().query("SELECT status FROM integration_status WHERE name='porkbun_imap'")).rows[0].status).toBe("failed");

    serve(messages);
    expect(await syncImapReplies("test")).toMatchObject({ scanned: 2, imported: 1, hasMore: false });
    expect((await pool().query("SELECT 1 FROM outreach_events WHERE kind='reply'")).rowCount).toBe(2);
    expect((await pool().query("SELECT 1 FROM imap_receipts")).rowCount).toBe(2);
    expect((await pool().query("SELECT last_uid FROM imap_cursors")).rows[0].last_uid).toBe("102");
  });

  it("does not search or fetch mail when no outreach has been attempted", async () => {
    expect(await syncImapReplies("test")).toMatchObject({ scanned: 0, imported: 0 });
    expect(mock.search).not.toHaveBeenCalled();
    expect(mock.fetchOne).not.toHaveBeenCalled();
    expect((await pool().query("SELECT last_uid FROM imap_cursors")).rows[0].last_uid).toBe("102");
  });
});
