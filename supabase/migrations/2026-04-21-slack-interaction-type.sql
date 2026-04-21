-- Add 'slack' to interactions.type allowed values
-- Run this in Supabase SQL editor

alter table interactions drop constraint if exists interactions_type_check;

alter table interactions add constraint interactions_type_check
  check (type in ('email','whatsapp','meeting','call','note','slack'));

-- Ensure unique index on source_id exists (required for upsert onConflict)
-- No-op if already present.
create unique index if not exists interactions_source_id_unique
  on interactions (source_id)
  where source_id is not null;
