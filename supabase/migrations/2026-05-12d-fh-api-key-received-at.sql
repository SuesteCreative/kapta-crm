-- ============================================================
-- 2026-05-12 — Manual API key receipt flag
-- API key itself does NOT pass through the CRM (data protection).
-- Pedro marks "API key recebida" manually with a timestamp.
-- ============================================================

alter table fh_integrations
  add column if not exists api_key_received_at timestamptz;

-- Backfill: rows that already had a non-empty fh_api_key get the flag set
update fh_integrations
  set api_key_received_at = updated_at
  where fh_api_key is not null
    and length(trim(fh_api_key)) > 0
    and api_key_received_at is null;
