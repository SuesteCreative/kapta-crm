-- ============================================================
-- PERF INDEXES
-- Targets the queries that drive perceived navigation slowness:
--   - Dashboard + /emails:   `where type = 'email' order by occurred_at desc`
--   - Customer detail page:  fallback lookup by metadata->>'matched_email'
--   - Dashboard widget:      pending unlinked meetings sorted by recorded_at
-- ============================================================
create index if not exists idx_interactions_type_occurred
  on interactions (type, occurred_at desc);

create index if not exists idx_interactions_matched_email
  on interactions ((metadata->>'matched_email'))
  where metadata ? 'matched_email';

create index if not exists idx_unlinked_meetings_pending_recorded
  on unlinked_meetings (recorded_at desc)
  where assigned_at is null;
