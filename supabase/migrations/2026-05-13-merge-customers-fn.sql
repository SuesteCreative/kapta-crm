-- ============================================================
-- 2026-05-13 — merge_customers(keep, merge) helper function
-- Bulk-safe customer dedup: moves all FK references from merge → keep,
-- then deletes the merge customer. Mirrors the logic of
-- /api/customers/[id]/merge but callable from SQL (faster for batch cleanup).
-- ============================================================

create or replace function merge_customers(keep_id uuid, merge_id uuid)
returns table (
  moved_identifiers     int,
  moved_interactions    int,
  moved_follow_ups      int,
  moved_tickets         int,
  moved_fh_integrations int,
  moved_email_drafts    int,
  dropped_identifiers   int
) language plpgsql as $$
declare
  m_id int := 0; m_int int := 0; m_fu int := 0; m_tk int := 0; m_fh int := 0; m_ed int := 0; d_id int := 0;
begin
  if keep_id = merge_id then
    raise exception 'keep_id and merge_id are equal';
  end if;
  if not exists (select 1 from customers where id = keep_id) then
    raise exception 'keep_id customer not found';
  end if;
  if not exists (select 1 from customers where id = merge_id) then
    raise exception 'merge_id customer not found';
  end if;

  -- Identifiers: move only those whose (type, value) doesn't already exist on keep.
  -- The remainder must be dropped (unique constraint on (type, value)).
  with movable as (
    select ci.id
    from customer_identifiers ci
    where ci.customer_id = merge_id
      and not exists (
        select 1 from customer_identifiers k
        where k.customer_id = keep_id
          and k.type = ci.type
          and lower(k.value) = lower(ci.value)
      )
  ),
  moved as (
    update customer_identifiers set customer_id = keep_id
    where id in (select id from movable)
    returning 1
  )
  select count(*) into m_id from moved;

  delete from customer_identifiers where customer_id = merge_id;
  get diagnostics d_id = row_count;

  -- Interactions
  with u as (update interactions set customer_id = keep_id where customer_id = merge_id returning 1)
  select count(*) into m_int from u;

  -- Follow-ups
  with u as (update follow_ups set customer_id = keep_id where customer_id = merge_id returning 1)
  select count(*) into m_fu from u;

  -- Tickets
  with u as (update tickets set customer_id = keep_id where customer_id = merge_id returning 1)
  select count(*) into m_tk from u;

  -- FH integrations (FK is set null on delete — re-link to keep_id)
  with u as (update fh_integrations set customer_id = keep_id where customer_id = merge_id returning 1)
  select count(*) into m_fh from u;

  -- Email drafts (primary_customer_id)
  with u as (update email_drafts set primary_customer_id = keep_id where primary_customer_id = merge_id returning 1)
  select count(*) into m_ed from u;

  -- Delete the merged customer row
  delete from customers where id = merge_id;

  return query select m_id, m_int, m_fu, m_tk, m_fh, m_ed, d_id;
end $$;
