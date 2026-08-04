-- 2026-08-04 — Disk IO budget exhaustion fix.
--
-- Supabase warned the project was depleting its Disk IO Budget; Postgres then
-- wedged (db UNHEALTHY, "Failed to connect to database") and needed a restart.
--
-- Root cause found via pg_stat_statements:
--
--   1. /api/fareharbor/pending-count filters on two metadata->> keys with no
--      supporting index. EXPLAIN showed a Seq Scan over all of `interactions`:
--      27,692 buffers (216 MB) touched, 4,047 ms, to return 49 rows.
--      The sidebar polled it every 60s from every open tab.
--      18,435 calls @ 3,148 ms mean = 16.1 hours of cumulative DB time.
--
--   2. The sync freshness check filters `type` and orders by `created_at`, but
--      the only index was (type, occurred_at) — wrong column, so every call
--      sorted. 10,891 calls @ 581 ms mean.
--
-- Expression index (not partial): PostgREST issues these as parameterized
-- prepared statements, so a partial index predicate on the literal 'true'
-- could not be proven to match under a generic plan. Indexing the expressions
-- themselves works under both generic and custom plans.
--
-- Measured after: 4,047 ms -> 44 ms (52 buffers), and 581 ms -> 0.12 ms.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interactions_fh_request
  ON public.interactions (
    (metadata->>'fh_integration_request'),
    (metadata->>'fh_integration_id'),
    occurred_at DESC
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interactions_type_created
  ON public.interactions (type, created_at DESC);

-- Planner statistics were empty (n_live_tup = 0 on every table) after the
-- restart, which pushes the planner toward seq scans regardless of indexes.
ANALYZE public.interactions;
ANALYZE public.customers;
ANALYZE public.customer_identifiers;
ANALYZE public.fh_integrations;
