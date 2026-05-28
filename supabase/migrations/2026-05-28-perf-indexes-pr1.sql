-- ============================================================
-- PERF INDEXES — PR 1
-- Follow-up to 2026-04-27-perf-indexes.sql.
-- Targets the remaining hot-path queries identified in PR 1:
--   - Dashboard inbound feed: type='email' AND direction='inbound' ORDER BY occurred_at
--   - Customers list: ORDER BY name
--   - Customer/Company detail: interactions per-customer ORDER BY occurred_at
-- ============================================================

-- Inbound-only partial index (the dashboard pulls 100 inbound rows).
create index if not exists idx_interactions_email_inbound_occurred
  on interactions (occurred_at desc)
  where type = 'email' and direction = 'inbound';

-- Customers list always orders by name.
create index if not exists idx_customers_name
  on customers (name);

-- Customer/Company detail pages pull interactions for a single customer.
-- The existing idx_interactions_type_occurred is great for global scans but
-- a per-customer scan still has to filter the full type-bucket; this index
-- gives a direct (customer_id, occurred_at desc) walk.
create index if not exists idx_interactions_customer_occurred
  on interactions (customer_id, occurred_at desc);
