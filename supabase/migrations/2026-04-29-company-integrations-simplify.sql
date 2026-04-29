-- ============================================================
-- 2026-04-29 — Simplify company_integrations: single platform list
-- ============================================================
-- Drop CHECK constraints on platform / input_platform / output_platform
-- so the UI can use a single unified dropdown.
-- ============================================================

alter table company_integrations
  drop constraint if exists company_integrations_platform_check,
  drop constraint if exists company_integrations_input_platform_check,
  drop constraint if exists company_integrations_output_platform_check;
