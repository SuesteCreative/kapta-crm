-- ============================================================
-- SCHEDULED EMAILS
-- Holds emails Pedro queued to send later. A cron + app-open trigger
-- processes rows where scheduled_for <= now() and status='pending'.
-- ============================================================
create table if not exists scheduled_emails (
  id                  uuid primary key default gen_random_uuid(),
  primary_customer_id uuid references customers(id) on delete set null,
  to_recipients       text[] not null,
  cc_recipients       text[] not null default '{}',
  bcc_recipients      text[] not null default '{}',
  subject             text not null,
  body                text not null,
  attachments         jsonb not null default '[]'::jsonb,
  scheduled_for       timestamptz not null,
  status              text not null default 'pending'
                        check (status in ('pending','sending','sent','failed','cancelled')),
  attempts            int not null default 0,
  last_error          text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_scheduled_emails_pending
  on scheduled_emails (scheduled_for)
  where status = 'pending';

alter table scheduled_emails enable row level security;

create policy "authenticated_full_access" on scheduled_emails
  for all to authenticated using (true) with check (true);
