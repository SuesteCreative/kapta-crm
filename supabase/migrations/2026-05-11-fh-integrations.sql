-- ============================================================
-- 2026-05-11 — FareHarbor integrations module
-- Tracks lifecycle of FH integration partners (PT + ES markets).
-- Single-tenant CRM: API key stored in plain text; revisit if
-- multi-user is ever introduced.
-- ============================================================

create table if not exists fh_integrations (
  id                    uuid primary key default gen_random_uuid(),
  shortname             text not null unique,
  name                  text not null,
  email                 text not null,
  country               text check (country in ('PT','ES','other')),
  invoicing_system      text,
  authorization         boolean not null default false,
  fh_api_key            text,
  status                text not null default 'new'
    check (status in ('new','onboarding','live','troubleshoot','follow_up','churned')),
  customer_id           uuid references customers(id) on delete set null,
  source_interaction_id uuid references interactions(id) on delete set null,
  notes                 text,
  last_contact_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists fh_integrations_status_idx   on fh_integrations (status);
create index if not exists fh_integrations_country_idx  on fh_integrations (country);
create index if not exists fh_integrations_customer_idx on fh_integrations (customer_id);
create index if not exists fh_integrations_source_idx   on fh_integrations (source_interaction_id);

create trigger fh_integrations_updated_at
  before update on fh_integrations
  for each row execute function update_updated_at();

alter table fh_integrations enable row level security;
create policy "fh_integrations_authenticated_full_access" on fh_integrations
  for all to authenticated using (true) with check (true);
