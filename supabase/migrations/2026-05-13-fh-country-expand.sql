-- ============================================================
-- 2026-05-13 — Expand fh_integrations.country whitelist
-- FareHarbor integrations now come from more countries than PT+ES.
-- Drop old constraint, add wider one with full FH onboarding list.
-- ============================================================

alter table fh_integrations
  drop constraint if exists fh_integrations_country_check;

alter table fh_integrations
  add constraint fh_integrations_country_check
  check (country in (
    'PT', 'ES', 'FR', 'DE', 'BE', 'IT', 'MX', 'AE', 'HU', 'CR', 'other'
  ));
