-- ============================================================
-- EMAIL READ STATE
-- Track which emails have been opened in the Kapta UI so the
-- /emails page can show unread visual indicators and optionally
-- pin unread to the top of the list.
--
-- Backfill strategy: existing rows default to `true` (clean slate).
-- IMAP sync + outbound send paths will explicitly set the value
-- on insert (inbound = false, outbound = true).
-- ============================================================
alter table interactions
  add column if not exists is_read boolean not null default true;

create index if not exists idx_interactions_email_unread
  on interactions (occurred_at desc)
  where type = 'email' and is_read = false;
