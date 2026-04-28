-- ============================================================
-- Kapta CRM — Supabase Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ============================================================
-- CUSTOMERS
-- ============================================================
create table customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  company     text,
  status      text not null default 'onboarding'
                check (status in ('onboarding','active','at-risk','troubleshooting','churned')),
  plan        text,
  health_score int default 3 check (health_score between 1 and 5),
  notes       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- CUSTOMER IDENTIFIERS
-- Core of identity resolution: one customer, many channels.
-- Match any email or phone to the same customer record.
-- ============================================================
create table customer_identifiers (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  type        text not null check (type in ('email','phone','whatsapp','slack_channel')),
  value       text not null,          -- e.g. "pedro@kapta.pt" or "+351912345678"
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (type, value)                -- one value can only belong to one customer
);

-- ============================================================
-- INTERACTIONS
-- Unified timeline: email, whatsapp, meeting, call, note
-- ============================================================
create table interactions (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  type         text not null check (type in ('email','whatsapp','meeting','call','note','slack')),
  direction    text check (direction in ('inbound','outbound')),   -- null for meetings/notes
  subject      text,
  content      text,
  source_id    text,           -- email Message-ID, whatsapp msg id, etc. (for dedup)
  -- Bubbles meeting fields
  bubbles_url  text,           -- e.g. https://app.usebubbles.com/xxx
  bubbles_title text,
  -- Extra metadata
  metadata     jsonb,          -- attachments, participants, cc/bcc, etc.
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- ============================================================
-- FOLLOW-UPS
-- Tasks tied to customers with due dates and priority
-- ============================================================
create table follow_ups (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  title        text not null,
  description  text,
  due_date     date,
  priority     text not null default 'medium'
                 check (priority in ('low','medium','high','urgent')),
  status       text not null default 'open'
                 check (status in ('open','done','snoozed')),
  snoozed_until date,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- ============================================================
-- TICKETS
-- Structured bug/issue reports to send to developers
-- ============================================================
create table tickets (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references customers(id) on delete cascade,
  title                text not null,
  description          text,
  steps_to_reproduce   text,
  expected_behavior    text,
  actual_behavior      text,
  priority             text not null default 'medium'
                         check (priority in ('low','medium','high','urgent')),
  status               text not null default 'open'
                         check (status in ('open','in-progress','resolved','closed')),
  tags                 text[] default '{}',
  -- Platform metadata
  platform             text check (platform in ('rioko','stripe_app','konnector')),
  input_platform       text check (input_platform in ('stripe','fareharbor','shopify','easypay','eupago','outro')),
  output_platform      text check (output_platform in ('invoicexpress','moloni','vendus','billin','holded','sage','outro')),
  account_number       text,
  references_list      text[] default '{}',                    -- payment IDs, booking refs, etc.
  source_interaction_id uuid references interactions(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ============================================================
-- TEMPLATES
-- Reusable message templates (email, whatsapp)
-- ============================================================
create table templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text check (type in ('email','whatsapp','note')),
  subject    text,
  body       text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- SEED: Default templates
-- ============================================================
insert into templates (name, type, subject, body) values
  ('Onboarding Welcome', 'email', 'Bem-vindo à Kapta!',
   'Olá {{name}},\n\nBem-vindo à Kapta! Estamos muito contentes por tê-lo connosco.\n\nSe tiver alguma dúvida durante o processo de onboarding, não hesite em contactar-nos.\n\nCum os melhores cumprimentos,\nPedro'),
  ('Follow-up após reunião', 'email', 'Follow-up — {{subject}}',
   'Olá {{name}},\n\nObrigado pela nossa conversa hoje. Conforme combinámos:\n\n{{action_points}}\n\nQualquer dúvida estou disponível.\n\nCum os melhores cumprimentos,\nPedro'),
  ('Issue acknowledged', 'email', 'Recebemos o seu pedido',
   'Olá {{name}},\n\nRecebemos o seu contacto e já estamos a analisar a situação. Entraremos em contacto em breve com uma resolução.\n\nObrigado pela sua paciência.\n\nCum os melhores cumprimentos,\nPedro'),
  ('Cancellation save', 'email', 'Lamentamos que queira cancelar',
   'Olá {{name}},\n\nFicámos a saber que está a ponderar cancelar a sua subscrição. Gostaríamos de perceber o motivo e ver se há algo que possamos fazer.\n\nEstará disponível para uma breve chamada esta semana?\n\nCum os melhores cumprimentos,\nPedro');

-- ============================================================
-- INDEXES for performance
-- ============================================================
create index on customer_identifiers (value);
create index on customer_identifiers (customer_id);
create index on interactions (customer_id, occurred_at desc);
create index on follow_ups (customer_id, due_date);
create index on follow_ups (status, due_date);
create index on tickets (customer_id, created_at desc);
create index on tickets (platform);
create index on tickets (source_interaction_id);

-- ============================================================
-- updated_at trigger helper
-- ============================================================
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger customers_updated_at before update on customers
  for each row execute function update_updated_at();

create trigger tickets_updated_at before update on tickets
  for each row execute function update_updated_at();

-- ============================================================
-- HELPER: resolve customer_id from any identifier value
-- Usage: select resolve_customer('pedro@kapta.pt');
-- ============================================================
create or replace function resolve_customer(identifier_value text)
returns uuid language sql stable as $$
  select customer_id from customer_identifiers
  where value = lower(trim(identifier_value))
  limit 1;
$$;
