-- ============================================================
-- 2026-05-12 — Status enum: add 'personalizado', rename 'churned' → 'lixo'
-- Must drop the check constraint first, update existing rows, then
-- add the new constraint with the full set.
-- ============================================================

alter table fh_integrations
  drop constraint if exists fh_integrations_status_check;

update fh_integrations set status = 'lixo' where status = 'churned';

alter table fh_integrations
  add constraint fh_integrations_status_check
  check (status in (
    'new', 'onboarding', 'api_received', 'integration_done',
    'live', 'troubleshoot', 'follow_up', 'personalizado', 'lixo'
  ));
