-- Allow 'slack_channel' as a customer_identifiers.type
-- Value is the Slack channel ID (e.g. "C0123ABC"), mapped to whichever
-- customer should receive internal/unmatched messages from that channel.

alter table customer_identifiers drop constraint if exists customer_identifiers_type_check;

alter table customer_identifiers add constraint customer_identifiers_type_check
  check (type in ('email','phone','whatsapp','slack_channel'));
