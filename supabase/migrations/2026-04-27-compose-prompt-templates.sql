-- ============================================================
-- COMPOSE PROMPT TEMPLATES
-- Allow templates of type 'compose-prompt' so Pedro can reuse
-- canned AI instructions when composing fresh emails.
-- ============================================================
alter table templates drop constraint if exists templates_type_check;

alter table templates add constraint templates_type_check
  check (type in ('email','whatsapp','note','compose-prompt'));

insert into templates (name, type, subject, body) values
  ('Pedido de feedback pós-onboarding', 'compose-prompt', null,
   'Quero pedir feedback ao cliente sobre o processo de onboarding: o que correu bem, o que pode melhorar, e se há alguma dúvida pendente. Tom amigável, mostrar disponibilidade para uma chamada curta.'),
  ('Aviso de upgrade de plano', 'compose-prompt', null,
   'Avisar o cliente que vamos subir de plano automaticamente daqui a 30 dias com base no uso atual. Listar o novo plano e o novo valor mensal. Oferecer alternativa de manter plano atual se preferir.'),
  ('Reagendar reunião', 'compose-prompt', null,
   'Pedir desculpa por ter de reagendar a reunião marcada. Sugerir 2-3 alternativas de horário esta semana. Manter tom profissional mas humano.'),
  ('Pedido de testimonial', 'compose-prompt', null,
   'Pedir ao cliente um curto testemunho para o site. Lembrar resultado concreto que tivemos juntos. Tornar fácil — basta 2-3 frases.'),
  ('Cobrança de fatura em atraso', 'compose-prompt', null,
   'Lembrar o cliente de fatura em atraso. Mencionar valor + número da fatura + dias em atraso. Tom firme mas educado, sem ameaças. Pedir confirmação de pagamento ou explicação.')
on conflict do nothing;
