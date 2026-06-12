-- Per-mailbox IMAP sync cursors (RFC 4549 incremental sync).
-- Replaces the date-based SEARCH SINCE watermark, which was vulnerable to
-- forged/future Date: headers and re-fetched envelopes of already-skipped
-- mail (spam, unknown senders) on every run.
-- If UIDVALIDITY changes the mailbox was rebuilt and the cursor row is
-- invalid; sync-core falls back to a date-search backfill and reseeds.
create table if not exists imap_cursors (
  mailbox     text primary key,
  uidvalidity text   not null,
  last_uid    bigint not null default 0,
  updated_at  timestamptz not null default now()
);

-- Service-role only (sync runs server-side); no anon/authenticated access.
alter table imap_cursors enable row level security;
