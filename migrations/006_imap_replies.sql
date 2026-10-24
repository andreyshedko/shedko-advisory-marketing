CREATE TABLE imap_cursors (
 mailbox_key text PRIMARY KEY, uid_validity text NOT NULL, last_uid bigint NOT NULL CHECK(last_uid >= 0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE imap_receipts (
 id uuid PRIMARY KEY, account_key text NOT NULL, mailbox_key text NOT NULL,
 uid_validity text NOT NULL, uid bigint NOT NULL CHECK(uid > 0), internet_message_id text,
 event_id uuid UNIQUE REFERENCES outreach_events(id) ON DELETE CASCADE,
 imported_at timestamptz NOT NULL DEFAULT now(), UNIQUE(mailbox_key,uid_validity,uid)
);
CREATE UNIQUE INDEX imap_incoming_message_once ON imap_receipts(account_key,internet_message_id) WHERE internet_message_id IS NOT NULL;
