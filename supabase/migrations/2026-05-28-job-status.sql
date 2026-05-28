-- ============================================================
-- JOB STATUS
-- Lightweight table for background jobs (Inngest) to notify the UI
-- via Supabase Realtime when they complete.
-- ============================================================
create table if not exists job_status (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                       -- e.g. 'imap_sync', 'ai_triage'
  status      text not null check (status in ('running','done','failed')),
  message     text,                                -- short human-readable result
  metadata    jsonb,                               -- counts, error details, etc.
  started_at  timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_job_status_kind_started
  on job_status (kind, started_at desc);

-- Auto-prune anything older than 7 days on insert (keeps table tiny).
create or replace function prune_job_status()
returns trigger language plpgsql as $$
begin
  delete from job_status where started_at < now() - interval '7 days';
  return new;
end $$;

drop trigger if exists trg_prune_job_status on job_status;
create trigger trg_prune_job_status
  after insert on job_status
  execute function prune_job_status();

-- Enable Realtime on this table so the UI can subscribe to changes.
alter publication supabase_realtime add table job_status;

-- RLS: authenticated users can read all rows. Writes happen only via the
-- service-role client from Inngest functions.
alter table job_status enable row level security;
create policy "job_status_read_all"
  on job_status for select
  to authenticated using (true);
