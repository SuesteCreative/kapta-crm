# Kapta CRM — Changelog

---

## [Unreleased] — Abril 2026

### Seletor de Idioma no Rascunho IA
- Botão PT / EN ao lado de "Gerar resposta com IA" no diálogo de email
- PT: Português europeu, "Olá [Nome]", "Com os melhores cumprimentos, Pedro"
- EN: Inglês britânico, "Hi [Name]", "Best regards, Pedro", placeholder `[check X]`
- Assinatura personalizada aplicada em ambos os idiomas

### Assinatura de Email
- Nova página **Definições** (`/settings`) com editor de assinatura (texto simples)
- Assinatura guardada na tabela `templates` (`type='signature'`, `name='__signature__'`)
- Adicionada automaticamente a cada email enviado pelo CRM (`/api/email/send`)
- Incluída no prompt do rascunho IA (`/api/ai/draft-reply`) — Claude usa a assinatura real

### Email na Timeline — Fix HTML + Resumo IA
- **Fix crítico**: emails HTML apareciam como código raw na timeline — HTML é agora stripped antes de exibir
- Texto longo truncado em 400 caracteres com botão "Ver mais / Ver menos"
- Botão **"Resumir"** por email: gera 3-5 bullet points com `claude-haiku-4-5` via `POST /api/ai/summarize-email` (rápido e económico)
- Bullets aparecem acima do corpo do email, dentro de um bloco destacado

### Follow-ups — Botão Responder Rápido
- Cada card "Sem resposta" tem agora botão **"Responder"** que abre `SendEmailDialog` inline (sem navegar para o cliente)
- Botão só aparece se o cliente tiver email registado
- Suporte a rascunho IA a partir do histórico de emails do cliente

### Dashboard — Resumo Semanal IA
- Botão **"Resumo semanal"** no header do dashboard
- Chama `POST /api/ai/weekly-digest`: analisa interações da semana, follow-ups e tickets
- Mostra painel inline com headline, destaques e ações urgentes (dispensável com ×)

### Página de Definições
- Nova entrada **"Definições"** na sidebar com ícone Settings
- Suporta extensão futura (notificações, preferências, etc.)

### Timeline do Cliente — Contexto Rápido
- Tira de contexto acima da timeline: último contacto, dias desde último inbound, follow-ups abertos, tickets abertos, total de interações



### AI — Deteção de Compromissos
- Nova rota `POST /api/ai/detect-commitments` analisa os últimos 60 dias de interações (emails, WhatsApp, reuniões Bubbles, chamadas, notas) e deteta compromissos feitos por Pedro ("vou enviar", "fico de ligar", "ficou acordado que…")
- Resultados aparecem na tab "Follow-ups (abertos)" como sugestões com badge de canal (📧 email / 💬 WhatsApp / 📞 chamada / 🎥 reunião / 📝 nota), citação do compromisso, prioridade sugerida e botão "Criar"
- Criação direta de follow-up a partir da sugestão; sugestão desaparece da lista após criação

### AI — Agrupamento de Problemas (Issue Clustering)
- Nova rota `POST /api/ai/cluster-issues` analisa emails e WhatsApp inbound dos últimos 90 dias e agrupa clientes com o mesmo problema
- Clusters aparecem na página de Tickets com nome do problema, descrição, lista de clientes afetados e exemplo
- Ações por cluster: **"Criar ticket"** (pré-preenchido com todos os afetados) e **"Enviar email a todos"** (abre diálogo bulk)

### Envio de Email em Massa
- Nova rota `POST /api/email/send-bulk` envia um email personalizado a múltiplos clientes de uma vez
- Novo componente `BulkEmailDialog`: lista de destinatários como chips, seletor de template, assunto e corpo
- Templates aplicados com substituição genérica (`{{name}}` → "cliente")
- Cada email enviado é registado como interação outbound no cliente respetivo

### AI — Triagem de Emails ("Analisar com IA")
- Nova rota `POST /api/ai/triage-inbox` classifica os emails por responder por prioridade (urgent/high/medium/low), categoria (suporte/comercial/financeiro…), resumo e ação recomendada
- Resultados persistidos em `interactions.metadata.ai_triage` — disponíveis imediatamente nas próximas sessões sem re-análise
- Na tab "Sem resposta", cada card mostra o resumo e a ação sugerida pela IA; ordenação automática por prioridade quando a triagem está disponível
- Emails já triados em sessões anteriores aparecem com os dados de IA **imediatamente ao abrir a página** (sem clicar no botão)

### AI — Filtro de Spam
- Nova rota `POST /api/ai/detect-spam` classifica emails como spam/legítimos usando o endereço de email real do remetente (via `customer_identifiers`)
- Botão **"Filtrar spam"** na tab "Sem resposta": remove em massa notificações de redes sociais, cold outreach, newsletters, emails automáticos
- Botão **×** em cada card da tab "Sem resposta": dismiss individual imediato (atualiza UI + persiste `is_spam: true` em metadata)
- Domínios pessoais (gmail, hotmail, sapo, etc.) e serviços automáticos (Instagram, Facebook…) detetados sem chamar IA
- HTML dos emails é stripped antes de enviar para Claude (evita enviar CSS como contexto)

### AI — Sugestão Automática de Ticket
- Nova rota `POST /api/ai/suggest-ticket` analisa as interações de um cliente e gera automaticamente título, descrição, passos para reproduzir, comportamento esperado/atual, prioridade e tags
- Ao abrir o diálogo "+ Ticket" em qualquer cliente, os campos são **pré-preenchidos pela IA** com base nos emails e interações existentes
- Spinner "A analisar emails…" enquanto a IA processa; badge "Preenchido por IA" quando concluído
- Todos os campos continuam editáveis antes de guardar

### AI — Limpeza de Empresas
- Nova rota `POST /api/ai/clean-companies` analisa todas as empresas e:
  - Remove automaticamente as de domínios pessoais (gmail, hotmail, sapo, outlook, icloud…) e serviços automáticos (Instagram, Facebook, LinkedIn…)
  - Para as restantes, analisa assinaturas de email para sugerir o nome real da empresa
  - Renomeia empresas cujo nome era apenas o domínio
- Botão **"Organizar com IA"** na página de Empresas; toast com resultado: "X removidas · Y renomeadas · Z mantidas"

### Importação de Contactos do Email
- Nova rota `GET /api/email/import-contacts` varre INBOX e Sent dos últimos 6 meses (max 200 por caixa)
- Cria automaticamente empresas a partir do domínio do email e associa clientes
- Ignora domínios pessoais, endereços noreply/mailer/bounce e domínios internos
- Botão **"Importar do email"** na página de Empresas

### Dashboard — Centro de Ação
- Coluna direita do dashboard substituída por **"O que responder"**: lista os emails por responder ordenados por prioridade IA, com ação recomendada em destaque e resumo
- KPI "Emails por responder" adicionado (substitui "Atividade recente")
- Subtítulo dinâmico no header: informa Pedro de follow-ups atrasados e emails por responder
- Dados sempre frescos: Supabase configurado com `cache: 'no-store'` em todos os fetches

### Sincronização de Email Automática
- Sidebar executa sync automático ao abrir a app (máximo uma vez a cada 10 minutos por sessão)
- Cron Vercel configurado para sync diário às 7h (plano Hobby; Pro permite frequência até 1 minuto)
- Sync silencioso: toast só aparece se houver emails novos; página refresca automaticamente se houver novos dados

### Robustez das Respostas de IA
- Todas as rotas de IA usam extração de JSON por regex (`/\[[\s\S]*\]/` ou `/\{[\s\S]*\}/`) em vez de parsing direto — funciona independentemente de Claude envolver a resposta em code fences ou texto adicional
- Erros de timeout do servidor mostram mensagem clara ("Servidor sem resposta — tente novamente") em vez de crash de JSON parse
- Respostas não-JSON do servidor tratadas graciosamente em todos os botões de IA

---

## Funcionalidades Base (Pré-Changelog)

- **Clientes**: lista, perfil, timeline de interações, follow-ups, tickets, envio de email, "Colar conversa"
- **Empresas**: lista com domínio e contagem de contactos, página de detalhe
- **Follow-ups**: tabs Sem resposta / Follow-ups abertos / Concluídos, criação manual, marcação como feito
- **Tickets**: lista com filtros de estado/prioridade, criação, cópia para clipboard em markdown
- **Templates**: criação e uso de templates de email
- **Sincronização IMAP**: importação de emails inbound e outbound para a timeline do cliente
- **Envio de email**: SMTP com suporte a templates, registado como interação outbound
- **Interações manuais**: registo de WhatsApp, reuniões, chamadas, notas
