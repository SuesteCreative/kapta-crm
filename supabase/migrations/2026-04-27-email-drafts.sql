-- ============================================================
-- EMAIL DRAFTS
-- Holds in-progress compose-from-scratch emails so Pedro can
-- save and resume later. Cleared on send.
-- ============================================================
create table if not exists email_drafts (
  id                  uuid primary key default gen_random_uuid(),
  primary_customer_id uuid references customers(id) on delete set null,
  to_recipients       jsonb not null default '[]'::jsonb,
  cc_recipients       jsonb not null default '[]'::jsonb,
  bcc_recipients      jsonb not null default '[]'::jsonb,
  subject             text,
  body                text,
  prompt              text,
  language            text default 'pt-PT',
  attachments         jsonb not null default '[]'::jsonb,
  inline_images       jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_email_drafts_updated
  on email_drafts (updated_at desc);

alter table email_drafts enable row level security;

create policy "authenticated_full_access" on email_drafts
  for all to authenticated using (true) with check (true);
