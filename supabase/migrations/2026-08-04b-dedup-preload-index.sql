-- 2026-08-04 — Covering index for the IMAP dedup preload.
--
-- Companion to the sync-loop fix in lib/imap/sync-core.ts (loadKnownSourceIds).
-- That preload now spans >= 120 days instead of a window anchored on the live
-- watermark, so it returns ~2.5k rows instead of 7. Without an index that is a
-- seq scan of the 85 MB interactions table on every sync run, which would put
-- back the disk IO drain fixed earlier the same day.
--
-- Partial + covering: the query is
--   select source_id where source_id is not null and occurred_at >= $1
--   order by occurred_at desc
-- so (occurred_at DESC, source_id) WHERE source_id IS NOT NULL gives an
-- Index Only Scan. `source_id IS NOT NULL` is a literal in the PostgREST
-- query (not a bound parameter), so the partial predicate matches under a
-- generic plan — unlike the metadata->> filters in 2026-08-04-disk-io-indexes.
--
-- Measured: Index Only Scan, 24 buffers, 17 ms for a 1000-row page.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interactions_occurred_source
  ON public.interactions (occurred_at DESC, source_id)
  WHERE source_id IS NOT NULL;

ANALYZE public.interactions;
