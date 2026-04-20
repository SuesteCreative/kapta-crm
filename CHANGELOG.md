# Kapta CRM — Changelog

---

## [Unreleased] — Abril 2026

### Fix — Sync de Team-Forwards (Bruno / site@ para Pedro)
- Sync IMAP não capturava emails onde FROM=@kapta.pt e TO=@kapta.pt — ambas as pontas internas → envelope sem endereço externo → interação perdida
- Body-parse do `From:` reencaminhado era corrido apenas para outbound; agora também em inbound quando `allFromAreTeam` e sem `primarySenderEmail`
- Bruno reencaminhar email de petstourism.com para Pedro → CRM deteta "info@petstourism.com" no body → auto-cria lead + guarda como inbound

### Auto-Sanitize de Encoding em Cada Sync
- Sync IMAP agora inclui passo de auto-descodificação: no início de cada execução, varre até 500 emails com sinais de conteúdo legado (`=C3=` presente + boundary MIME) e re-descodifica in-place
- Helper puro `lib/decode-legacy-email.ts` (TextDecoder — funciona browser + Node): extrai secção `text/plain` e resolve sequências hex UTF-8
- Idempotente — rows já limpos são saltados pelo `looksLikeLegacyEmail`; após 1-2 syncs todos os emails ficam UTF-8 legível
- Sem botão manual / endpoint separado — acontece silenciosamente. Resposta de sync reporta `legacy_fixed: N`

### Fix Raiz — Parse MIME Correto (Outlook, Quoted-Printable, Charsets)
- Sync IMAP usava `bodyParts: ['1']` que para emails multipart (Outlook) retorna o container MIME com boundaries e headers — causava conteúdo tipo `--_000_GVTP...Content-Type: text/plain` a aparecer na timeline
- Quoted-printable também não era descodificado — `=C3=A7` em vez de `ç`, `=C3=A3o` em vez de `ão`
- Adicionada dependência `mailparser` (standard Node MIME parser)
- Refactor de 2-pass: pass 1 só envelopes (dedup barato), pass 2 pull source + `simpleParser` só para novos — reduz bandwidth em syncs incrementais
- `simpleParser` devolve `text`/`html`/`from`/`to`/`attachments` já descodificados (charset + quoted-printable + base64 + nested multipart tudo tratado)
- Attachments: agora extraídos diretamente do `parsed.attachments` (Buffer decoded) em vez de walk manual do bodyStructure + fetchOne por part
- Fallback "Itens Enviados" adicionado ao regex de deteção da pasta Sent (Outlook localizado pt-PT)
- Aplicado em `sync/route.ts` e `sync-customer/route.ts`
- **Nota**: emails já sincronizados com conteúdo partido não são re-processados (dedup por `source_id`). Para limpar histórico, apagar as interações afetadas e re-sync ou pedir backfill route dedicada

### Contexto IA (Memory Global)
- Novo editor **"Contexto IA (Memory)"** em `/settings`: textarea markdown livre para notas sobre integrações, troubleshoots recorrentes, tom de resposta e clientes chave
- Guardado em `templates` (`name='__ai_memory__'`, `type='note'`)
- Injetado como bloco `CONTEXTO DO NEGÓCIO` no system prompt de **todas** as rotas IA relevantes: `draft-reply`, `refine-draft`, `suggest-ticket`, `suggest-follow-up`, `draft-resolution`, `triage-inbox`, `detect-commitments`, `cluster-issues`, `suggest-follow-ups-global`, `suggest-tickets-global`, `customer-summary`, `company-summary`, `weekly-digest`
- Helper partilhado `lib/ai-memory.ts` (`getAiMemory` + `memorySystemBlock`) — single source of truth
- Injetado com `cache_control: ephemeral` → custo residual com Claude prompt cache (~$0.005/dia para ~500 tokens × 100 calls)
- Contador de tokens estimado no editor (`length / 4`)

### Fundir Clientes (Merge)
- Botão "Fundir com..." (ícone de merge) no header da página de cada cliente
- Pesquisa interativa de clientes duplicados
- Diálogo de confirmação com aviso explícito de irreversibilidade
- Migra em paralelo todas as interações, follow-ups, tickets e identificadores do cliente selecionado para o cliente atual
- Identificadores duplicados são ignorados (não gera conflito de chave única)
- O cliente duplicado é eliminado após a migração
- Nova rota `POST /api/customers/[id]/merge` com `{ source_id }`

### Agrupamento de Emails por Thread
- Emails com o mesmo assunto (normalizado) são agrupados num cartão de thread na timeline
- Strip automático de prefixos `Re:`, `Fwd:`, `RES:`, `ENC:` e variantes antes de comparar assuntos
- Threads mostram todas as mensagens em ordem cronológica com indicador de direção (enviado/recebido)
- Apenas emails com 2+ mensagens no mesmo assunto dentro de 30 dias são agrupados — emails únicos mantêm-se como itens individuais
- Compatível com a timeline composta (emails de endereços alternativos também são agrupados)

### Eliminar Cliente
- Botão de eliminar (ícone vermelho) no header da página do cliente
- Diálogo de confirmação com aviso explícito de irreversibilidade
- Apaga em paralelo todas as interações, follow-ups, tickets e identificadores antes de apagar o cliente
- Redireciona para a lista de clientes após eliminação

### Fix — Sincronização IMAP Mais Rápida (Filtro SINCE)
- Sync global passou a usar `SINCE 90 dias` em vez de `1:*` — evita descarregar mensagens já processadas em cada execução
- Primeira sync após esta versão notavelmente mais rápida em caixas com histórico longo

### Fix — Auto-criação de Leads para Remetentes Automáticos
- Emails de `noreply`, `mailer-daemon`, `newsletter`, `bounce`, `unsubscribe`, etc. já não criam leads automaticamente
- Estes remetentes são agora contabilizados em `skipped_unknown_outbound` e ignorados

### Fix Raiz — Criação de Duplicados em Sync Outbound
- Removida auto-criação de clientes para destinatários outbound desconhecidos (era a causa de todos os duplicados tipo "Joao Sarmento")
- Se o endereço TO de um email enviado não está no CRM, o email é ignorado — o utilizador adiciona o cliente manualmente

### Resolver Interações Mal-ligadas (Global)
- Nova rota `POST /api/customers/relink-all` varre todas as interações cujo `matched_email` pertence a um cliente diferente do `customer_id`
- Modos `preview` (conta sem alterar) e `confirm` (executa a migração)
- Deteta clientes órfãos após a migração (0 interações + 0 tickets + 0 follow-ups)
- Botão **"Verificar e corrigir"** em Definições com fluxo preview → confirmação

### Timeline Composta — Múltiplos Emails por Cliente
- A timeline de cada cliente agrega interações de **todos os emails registados** no cliente (não apenas as ligadas por `customer_id`)
- Emails sincronizados antes de um endereço alternativo ser adicionado continuam a aparecer na timeline correta
- Deduplicação por ID garante que nenhuma interação aparece duplicada
- Ordenação por data mantida após merge das fontes

### Re-ligação Automática de Interações ao Adicionar Email
- Ao adicionar um identificador de email a um cliente, o CRM verifica automaticamente se existem interações noutros clientes associadas a esse endereço
- **Verificação de conflito**: se o email já estiver registado noutro cliente, mostra aviso e não move nada
- **Pré-visualização**: mostra quantas interações seriam movidas e de que clientes, antes de fazer qualquer alteração
- **Diálogo de confirmação** (design system Shadcn — sem `window.confirm`) para o utilizador aprovar a migração
- **Detecção de órfãos**: após re-ligação, identifica clientes duplicados auto-criados que ficaram sem interações, tickets ou follow-ups — alerta para eliminação manual
- Nova rota `POST /api/customers/[id]/relink-identifier` com modos `preview` e `confirm`

### AI — Sugestão Global de Follow-ups
- Nova rota `POST /api/ai/suggest-follow-ups-global` analisa os emails inbound dos últimos 30 dias e sugere a ação mais importante por cliente
- Exclui automaticamente clientes que já têm follow-up aberto
- Botão **"Sugerir follow-ups"** na página de Follow-ups; cards de sugestão com prioridade, descrição e botão "Criar"
- Usa `claude-haiku-4-5` com prompt cacheado (rápido e económico)

### AI — Sugestão Global de Tickets
- Nova rota `POST /api/ai/suggest-tickets-global` analisa os emails inbound dos últimos 45 dias e identifica clientes com problemas não resolvidos
- Exclui clientes com ticket aberto/em progresso criado nos últimos 14 dias
- Botão **"Analisar com IA"** na página de Tickets; secção colapsável "Sugestões IA" com tags, prioridade e botão "Criar ticket"

### Fix — Sincronização da Pasta Sent (Outlook / Exchange)
- IMAP sync usava caminho fixo `'Sent'` para a pasta de enviados — Outlook usa `'Sent Items'`, causando falha silenciosa
- Deteção automática via flag IMAP `SPECIAL-USE \Sent` (RFC 6154), com fallback por regex para nomes comuns em PT/EN/DE/FR
- Corrigido em `sync/route.ts` e `sync-customer/route.ts`

### Fix — Filtro de Spam com Metadata NULL
- `.not('metadata->>is_spam', 'eq', 'true')` excluía todos os emails com `metadata = NULL` (a maioria) — bug crítico que mostrava 0 emails
- Filtro movido para JavaScript (`e.metadata?.is_spam !== true`) em todos os componentes e rotas afetadas

### Fix — Overwrite de Metadata ao Marcar Spam
- Operações de dismiss/spam sobrescreviam `metadata` completo (perdiam `attachments`, `cc`, `bcc`, `ai_triage`)
- Corrigido: spread do metadata existente antes de definir `is_spam: true`

### Fix — Log Silencioso no Envio de Email
- `/api/email/send` não verificava erro do insert em `interactions` após envio SMTP
- Adicionado log de erro explícito quando o registo da interação falha

### Autenticação simples (sem Clerk)
- Login com email + password (`pedro@kapta.pt`)
- `proxy.ts` (Next.js 16 — substitui `middleware.ts`) protege todas as rotas
- Sessão em cookie `kapta_session` httpOnly, 30 dias
- Password guardada como HMAC-SHA256 em `.env.local` (nunca em texto simples)
- Botão de logout na sidebar
- Página `/login` com design Obsidian Office

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
