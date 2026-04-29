-- ============================================================
-- 2026-04-29 — Company integrations (multi-row per company)
-- ============================================================
-- Mirrors the platform/input/output/account/references fields added to
-- tickets, but at the company level so we can list every integration
-- a company runs (some companies have several Konnector flows).
-- ============================================================

create table if not exists company_integrations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  platform        text not null
                    check (platform in ('rioko','stripe_app','konnector')),
  input_platform  text
                    check (input_platform in ('stripe','fareharbor','shopify','easypay','eupago','outro')),
  output_platform text
                    check (output_platform in ('invoicexpress','moloni','vendus','billin','holded','sage','outro')),
  account_number  text,
  references_list text[] default '{}',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists company_integrations_company_idx on company_integrations (company_id);
create index if not exists company_integrations_platform_idx on company_integrations (platform);

create trigger company_integrations_updated_at
  before update on company_integrations
  for each row execute function update_updated_at();
