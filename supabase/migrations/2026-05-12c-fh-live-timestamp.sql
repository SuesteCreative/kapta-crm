-- ============================================================
-- 2026-05-12 — Add live_at timestamp
-- Decouples "Em produção" from the status enum so Pedro can mark
-- an integration as troubleshoot WITHOUT losing the live flag.
-- ============================================================

alter table fh_integrations
  add column if not exists live_at timestamptz;

-- Backfill: rows currently at status='live' get live_at = updated_at
update fh_integrations
  set live_at = updated_at
  where status = 'live' and live_at is null;
