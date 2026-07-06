-- ============================================================
-- FOLLOW-UP REMINDERS
-- Turns follow_ups into actionable reminders:
--  * link to the email that triggered them (context for the AI draft)
--  * cache an optional pre-written draft
--  * track the last digest send so the daily email doesn't repeat
--  * flag auto-created (by the commitment detector on email send)
-- Run this in the Supabase SQL editor.
-- ============================================================

alter table follow_ups
  add column if not exists source_interaction_id uuid references interactions(id) on delete set null,
  add column if not exists draft_subject      text,
  add column if not exists draft_body         text,
  add column if not exists reminder_last_sent date,
  add column if not exists auto_created       boolean not null default false;

-- Fast lookup for the "due" accordion and the daily digest:
-- open follow-ups ordered by due date.
create index if not exists idx_follow_ups_open_due
  on follow_ups (due_date)
  where status = 'open';
