-- ============================================================
-- 2026-04-28 — Ticket platform / refs / source-email metadata
-- ============================================================
-- Adds: platform (Kapta product), input/output platforms (data flow),
--       account_number, references_list, source_interaction_id.
-- references_list (not "references" — reserved SQL keyword).
-- ============================================================

alter table tickets
  add column if not exists platform text
    check (platform in ('rioko','stripe_app','konnector')),
  add column if not exists input_platform text
    check (input_platform in ('stripe','fareharbor','shopify','easypay','eupago','outro')),
  add column if not exists output_platform text
    check (output_platform in ('invoicexpress','moloni','vendus','billin','holded','sage','outro')),
  add column if not exists account_number text,
  add column if not exists references_list text[] default '{}',
  add column if not exists source_interaction_id uuid
    references interactions(id) on delete set null;

create index if not exists tickets_platform_idx on tickets (platform);
create index if not exists tickets_source_interaction_idx on tickets (source_interaction_id);
