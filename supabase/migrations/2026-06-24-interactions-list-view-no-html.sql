-- The emails list page polls every 5-15 min and re-fetches up to 200 rows'
-- `metadata` column, which embeds the full HTML email body (lib/imap/sync-core.ts
-- writes metadata.html = bodyHtml). The list view never reads metadata.html —
-- the open-email body is loaded separately by /api/emails/[id]/body — so that
-- key was pure wasted Supabase egress on every list load. This view strips it
-- at the query level (PostgREST select projection can't exclude JSON keys,
-- only a view/expression can) while leaving every other column untouched.
create or replace view public.interactions_email_list as
select
  id, customer_id, type, direction, subject, content, source_id,
  bubbles_url, bubbles_title,
  (metadata - 'html') as metadata,
  occurred_at, created_at, is_read
from public.interactions;

grant select on public.interactions_email_list to anon, authenticated, service_role;
