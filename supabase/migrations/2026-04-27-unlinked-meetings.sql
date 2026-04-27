-- ============================================================
-- UNLINKED MEETINGS
-- Bubbles webhook lands meetings here when no attendee email
-- matches a known customer. Pedro assigns them later from the
-- dashboard widget; the row is then promoted to interactions.
-- ============================================================
create table if not exists unlinked_meetings (
  id           uuid primary key default gen_random_uuid(),
  title        text,
  summary      text,
  transcript   text,
  bubbles_url  text,
  attendees    text[] default '{}',   -- raw emails parsed from webhook payload
  recorded_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  assigned_at  timestamptz             -- set when promoted to interactions
);

create index if not exists idx_unlinked_meetings_pending
  on unlinked_meetings (recorded_at desc)
  where assigned_at is null;
