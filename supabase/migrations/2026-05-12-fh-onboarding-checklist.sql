-- ============================================================
-- 2026-05-12 — FareHarbor onboarding checklist
-- Two additive timestamps to track onboarding funnel steps.
-- All other steps are derived from existing columns.
-- ============================================================

alter table fh_integrations
  add column if not exists onboarding_email_sent_at  timestamptz,
  add column if not exists integration_completed_at  timestamptz;
