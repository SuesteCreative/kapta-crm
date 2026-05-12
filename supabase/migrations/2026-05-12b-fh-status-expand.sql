-- ============================================================
-- 2026-05-12 — Expand fh_integrations.status enum
-- Adds: api_received, integration_done
-- Renames live → keep existing 'live' value (no rename, just add)
-- ============================================================

alter table fh_integrations
  drop constraint if exists fh_integrations_status_check;

alter table fh_integrations
  add constraint fh_integrations_status_check
  check (status in (
    'new', 'onboarding', 'api_received', 'integration_done',
    'live', 'troubleshoot', 'follow_up', 'churned'
  ));
