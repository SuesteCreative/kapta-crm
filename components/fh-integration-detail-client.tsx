'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Plug, CheckCircle2, UserPlus, CalendarCheck, Save, Loader2,
  Eye, EyeOff, Mail, Trash2, Send, Reply, ChevronDown, ChevronUp, Sparkles,
  ArrowDownLeft, ArrowUpRight, Circle, Lock, Key, Wrench, Rocket,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { stripHtml } from '@/lib/html-utils'
import { FollowUpDialog } from '@/components/follow-up-dialog'
import { SendEmailDialog, type EmailContact } from '@/components/send-email-dialog'
import { EmailHtmlViewer } from '@/components/email-html-viewer'
import {
  FH_STATUS_LABELS, FH_INVOICING_SYSTEMS,
  type FhIntegration, type FhIntegrationStatus, type FhCountry,
  type Interaction, type CustomerIdentifier,
} from '@/lib/database.types'
import { resolveOrCreateCustomerForFh } from '@/lib/customer-resolver'

type FhRow = FhIntegration & {
  customers: {
    id: string
    name: string
    company: string | null
    customer_identifiers?: CustomerIdentifier[]
  } | null
}

interface Props {
  fh: FhRow
  sourceEmail: Interaction | null
  interactions: Interaction[]
}

// ────────────────────────────────────────────────────────────────────────────
// Timeline threading — copied (stripped) from components/customer-detail-client.tsx:116-194.
// Future cleanup: extract to a shared <InteractionsTimeline> once both pages
// have settled. Today, copy is safer than refactoring a 1408-line working file.
// ────────────────────────────────────────────────────────────────────────────

type ThreadItem =
  | { kind: 'single'; i: Interaction }
  | { kind: 'email-thread'; subject: string; messages: Interaction[] }

const EMAIL_THREAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function normalizeSubject(raw: string): string {
  let s = raw
  let prev = ''
  while (s !== prev) {
    prev = s
    s = s.replace(/^(re|fw|fwd|res|enc|reen|rv|tr):\s*/gi, '').trim()
  }
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function groupTimeline(interactions: Interaction[]): ThreadItem[] {
  const bySubject = new Map<string, Interaction[]>()
  for (const i of interactions) {
    if (i.type !== 'email' || !i.subject) continue
    const key = normalizeSubject(i.subject)
    if (!bySubject.has(key)) bySubject.set(key, [])
    bySubject.get(key)!.push(i)
  }

  const threaded = new Set<string>()
  const items: Array<{ item: ThreadItem; ts: number }> = []

  for (const [, msgs] of bySubject) {
    const sorted = [...msgs].sort((a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
    )
    const oldest = new Date(sorted[0].occurred_at).getTime()
    const newest = new Date(sorted[sorted.length - 1].occurred_at).getTime()
    if (sorted.length >= 2 && newest - oldest <= EMAIL_THREAD_WINDOW_MS) {
      for (const m of sorted) threaded.add(m.id)
      items.push({ item: { kind: 'email-thread', subject: sorted[0].subject!, messages: sorted }, ts: newest })
    }
  }

  for (const i of interactions) {
    if (threaded.has(i.id)) continue
    items.push({ item: { kind: 'single', i }, ts: new Date(i.occurred_at).getTime() })
  }

  return items.sort((a, b) => b.ts - a.ts).map((x) => x.item)
}

// ────────────────────────────────────────────────────────────────────────────

export function FhIntegrationDetailClient({ fh, sourceEmail, interactions }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    shortname: fh.shortname,
    name: fh.name,
    email: fh.email,
    country: (fh.country ?? '') as '' | FhCountry,
    invoicing_system: fh.invoicing_system ?? '',
    authorized: fh.authorized,
    fh_api_key: fh.fh_api_key ?? '',
    status: fh.status,
    notes: fh.notes ?? '',
    last_contact_at: fh.last_contact_at ?? '',
  })
  const [showKey, setShowKey]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [converting, setConverting] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [markingIntegration, setMarkingIntegration] = useState(false)

  type SendMode = 'compose' | 'onboarding' | 'reply'
  const [sendOpen, setSendOpen] = useState(false)
  const [sendMode, setSendMode] = useState<SendMode>('compose')
  const [replySubject, setReplySubject] = useState<string | null>(null)
  const [onboardingBody, setOnboardingBody] = useState<string>('')
  const [onboardingSubject, setOnboardingSubject] = useState<string>('')

  // Timeline UI state
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [summaries, setSummaries] = useState<Record<string, string>>({})
  const [summarizing, setSummarizing] = useState<Record<string, boolean>>({})

  const threadItems = useMemo(() => groupTimeline(interactions), [interactions])

  async function handleSave() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('fh_integrations')
        .update({
          shortname: form.shortname.trim(),
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          country: form.country || null,
          invoicing_system: form.invoicing_system.trim() || null,
          authorized: form.authorized,
          fh_api_key: form.fh_api_key.trim() || null,
          status: form.status,
          notes: form.notes.trim() || null,
          last_contact_at: form.last_contact_at || null,
        })
        .eq('id', fh.id)
      if (error) throw error
      toast.success('Guardado!')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function markOnboarded() {
    const nowIso = new Date().toISOString()
    setSaving(true)
    try {
      const { error } = await supabase
        .from('fh_integrations')
        .update({ status: 'live', last_contact_at: nowIso })
        .eq('id', fh.id)
      if (error) throw error
      setForm((f) => ({ ...f, status: 'live', last_contact_at: nowIso }))
      toast.success('Marcado como em produção.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setSaving(false)
    }
  }

  async function markIntegrationDone() {
    setMarkingIntegration(true)
    try {
      const nowIso = new Date().toISOString()
      const { error } = await supabase
        .from('fh_integrations')
        .update({ integration_completed_at: nowIso })
        .eq('id', fh.id)
      if (error) throw error
      toast.success('Integração marcada como concluída.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setMarkingIntegration(false)
    }
  }

  async function linkCustomer() {
    if (fh.customer_id) { toast.info('Já está ligado a um cliente.'); return }
    setConverting(true)
    try {
      const result = await resolveOrCreateCustomerForFh({
        email: form.email,
        contactName: form.name,
      })
      const { error: linkErr } = await supabase
        .from('fh_integrations')
        .update({ customer_id: result.customer_id })
        .eq('id', fh.id)
      if (linkErr) throw linkErr

      toast.success(result.created_customer ? 'Cliente criado e ligado.' : 'Cliente existente ligado.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao ligar cliente.')
    } finally {
      setConverting(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Apagar esta integração? Esta ação não pode ser desfeita.')) return
    setDeleting(true)
    try {
      const { error } = await supabase.from('fh_integrations').delete().eq('id', fh.id)
      if (error) throw error
      if (fh.source_interaction_id) {
        const { data: src } = await supabase
          .from('interactions')
          .select('metadata')
          .eq('id', fh.source_interaction_id)
          .maybeSingle()
        if (src?.metadata && (src.metadata as Record<string, unknown>).fh_integration_id) {
          const next = { ...(src.metadata as Record<string, unknown>) }
          delete (next as Record<string, unknown>).fh_integration_id
          await supabase.from('interactions').update({ metadata: next }).eq('id', fh.source_interaction_id)
        }
      }
      toast.success('Integração apagada.')
      router.push('/fareharbor')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
      setDeleting(false)
    }
  }

  async function openCompose() {
    setSendMode('compose')
    setReplySubject(null)
    setOnboardingSubject('')
    setOnboardingBody('')
    setSendOpen(true)
  }

  async function openOnboarding() {
    // Pull the "FareHarbor Onboarding" template (seed via SQL). If missing, fall back to a built-in copy.
    const { data: tpl } = await supabase
      .from('templates')
      .select('subject, body')
      .ilike('name', 'FareHarbor Onboarding')
      .maybeSingle()

    const subject = (tpl?.subject ?? 'Bem-vindo à integração FareHarbor — {{name}}')
      .replaceAll('{{name}}', form.name)
      .replaceAll('{{shortname}}', form.shortname)

    const body = (tpl?.body ??
`Olá {{name}},

Obrigado pelo teu interesse na integração FareHarbor com a Kapta. Para avançarmos, preciso de:

1. A tua API Key de FareHarbor (FareHarbor → User Settings → API Keys)
2. Confirmação do shortname: {{shortname}}
3. Confirmação do sistema de faturação a utilizar

Após receberes a API Key, responde a este email com a chave e eu trato da configuração técnica.

Qualquer dúvida estou disponível.

Cumprimentos,
Pedro`)
      .replaceAll('{{name}}', form.name)
      .replaceAll('{{shortname}}', form.shortname)

    setSendMode('onboarding')
    setReplySubject(null)
    setOnboardingSubject(subject)
    setOnboardingBody(body)
    setSendOpen(true)
  }

  function openReply(i: Interaction) {
    const subj = i.subject ?? ''
    const finalSubj = /^re:/i.test(subj) ? subj : (subj ? `Re: ${subj}` : '')
    setSendMode('reply')
    setReplySubject(finalSubj)
    setOnboardingSubject('')
    setOnboardingBody('')
    setSendOpen(true)
  }

  async function handleSent() {
    // Only the onboarding flow updates the checklist timestamp.
    if (sendMode !== 'onboarding') { router.refresh(); return }
    try {
      const nowIso = new Date().toISOString()
      await supabase
        .from('fh_integrations')
        .update({ onboarding_email_sent_at: nowIso, last_contact_at: nowIso })
        .eq('id', fh.id)
      router.refresh()
    } catch {
      // Send already succeeded; checklist tick is best-effort.
    }
  }

  async function deleteInteraction(id: string) {
    if (!confirm('Apagar este registo?')) return
    try {
      const { error } = await supabase.from('interactions').delete().eq('id', id)
      if (error) throw error
      toast.success('Apagado.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
    }
  }

  async function summarizeEmail(id: string, content: string | null, subject: string | null) {
    if (!content) return
    setSummarizing((s) => ({ ...s, [id]: true }))
    try {
      const res = await fetch('/api/ai/summarize-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: stripHtml(content), subject }),
      })
      const json = await res.json()
      if (json?.summary) setSummaries((s) => ({ ...s, [id]: json.summary }))
    } catch {
      // silent — summarize is best-effort
    } finally {
      setSummarizing((s) => ({ ...s, [id]: false }))
    }
  }

  const last_contact_input = form.last_contact_at
    ? new Date(form.last_contact_at).toISOString().slice(0, 16)
    : ''

  const apiKeyReceivedAt = form.fh_api_key.trim().length > 0 ? fh.updated_at : null
  const liveAt = form.status === 'live' ? (fh.last_contact_at ?? null) : null

  const allEmails: EmailContact[] = fh.customers?.customer_identifiers
    ?.filter((i) => i.type === 'email')
    .map((i) => ({ label: fh.customers!.name, email: i.value })) ?? []

  const customerEmailForSend = form.email.trim().toLowerCase() ||
    (fh.customers?.customer_identifiers?.find((i) => i.type === 'email')?.value ?? '')

  const initialSubjectForSend =
    sendMode === 'onboarding' ? onboardingSubject :
    sendMode === 'reply'      ? (replySubject ?? '') :
    undefined

  const initialBodyForSend = sendMode === 'onboarding' ? onboardingBody : undefined

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/fareharbor" className="rounded-md p-1.5 hover:bg-[var(--border)]" title="Voltar">
          <ArrowLeft className="h-4 w-4" style={{ color: 'var(--muted-foreground)' }} />
        </Link>
        <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
          <Plug className="h-5 w-5" style={{ color: 'var(--primary)' }} />
          {fh.name}
        </h1>
        <span
          className="text-[11px] font-mono rounded px-1.5 py-px"
          style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
        >
          {fh.shortname}
        </span>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={markOnboarded}
          disabled={saving || form.status === 'live'}
          className="gap-1.5"
          style={{ background: 'rgba(45,185,117,0.15)', color: '#1a9e6c' }}
        >
          <CheckCircle2 className="h-4 w-4" />
          Marcar em produção
        </Button>
        {!fh.customer_id && (
          <Button
            onClick={linkCustomer}
            disabled={converting}
            variant="outline"
            className="gap-1.5"
            title="Ligar cliente (registo legado sem cliente associado)"
          >
            {converting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Ligar cliente
          </Button>
        )}
        <Button
          onClick={() => setFollowUpOpen(true)}
          disabled={!fh.customer_id}
          variant="outline"
          className="gap-1.5"
          title={fh.customer_id ? 'Agendar follow-up' : 'Liga primeiro um cliente'}
        >
          <CalendarCheck className="h-4 w-4" />
          Agendar follow-up
        </Button>
        <div className="flex-1" />
        <Button onClick={handleDelete} disabled={deleting} variant="outline" className="gap-1.5" style={{ color: '#C0272B' }}>
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Apagar
        </Button>
      </div>

      {fh.customers && (
        <Link
          href={`/customers/${fh.customers.id}`}
          className="block rounded-lg p-3 text-[13px] hover:opacity-80"
          style={{ background: 'rgba(91,91,214,0.06)', border: '1px solid rgba(91,91,214,0.2)', color: 'var(--primary)' }}
        >
          Cliente ligado → <strong>{fh.customers.name}</strong>{fh.customers.company ? ` · ${fh.customers.company}` : ''}
        </Link>
      )}

      <OnboardingChecklist
        emailSentAt={fh.onboarding_email_sent_at}
        apiKeyReceivedAt={apiKeyReceivedAt}
        integrationDoneAt={fh.integration_completed_at}
        liveAt={liveAt}
        onSendOnboarding={openOnboarding}
        onMarkIntegrationDone={markIntegrationDone}
        markingIntegration={markingIntegration}
        canSend={!!fh.customer_id}
      />

      <Tabs defaultValue="ficha" className="w-full">
        <TabsList>
          <TabsTrigger value="ficha">Ficha</TabsTrigger>
          <TabsTrigger value="timeline">Timeline · {interactions.length}</TabsTrigger>
        </TabsList>

        <TabsContent value="ficha" className="mt-4 space-y-6">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Shortname</Label>
                <Input value={form.shortname} onChange={(e) => setForm({ ...form, shortname: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>País</Label>
                <Select value={form.country || undefined} onValueChange={(v) => setForm({ ...form, country: v as FhCountry })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PT">Portugal</SelectItem>
                    <SelectItem value="ES">Espanha</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Sistema de faturação</Label>
                <Input
                  value={form.invoicing_system}
                  onChange={(e) => setForm({ ...form, invoicing_system: e.target.value })}
                  list="fh-invoicing-systems-detail"
                />
                <datalist id="fh-invoicing-systems-detail">
                  {FH_INVOICING_SYSTEMS.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as FhIntegrationStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FH_STATUS_LABELS) as FhIntegrationStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{FH_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>FH API Key</Label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={form.fh_api_key}
                  onChange={(e) => setForm({ ...form, fh_api_key: e.target.value })}
                  autoComplete="off"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--border)]"
                  title={showKey ? 'Esconder' : 'Mostrar'}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="space-y-1.5">
                <Label>Último contacto</Label>
                <Input
                  type="datetime-local"
                  value={last_contact_input}
                  onChange={(e) => setForm({
                    ...form,
                    last_contact_at: e.target.value ? new Date(e.target.value).toISOString() : '',
                  })}
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <input
                  id="fh-auth-detail"
                  type="checkbox"
                  checked={form.authorized}
                  onChange={(e) => setForm({ ...form, authorized: e.target.checked })}
                  className="h-4 w-4 rounded"
                />
                <Label htmlFor="fh-auth-detail" className="cursor-pointer">Autorização confirmada</Label>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Textarea
                rows={4}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Estado do onboarding, bloqueios, próximos passos…"
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={handleSave} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar
              </Button>
            </div>
          </div>

          {/* Source email */}
          {sourceEmail && (
            <div className="rounded-xl p-5 space-y-2" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--foreground)' }}>
                <Mail className="h-4 w-4" style={{ color: 'var(--primary)' }} />
                Email de origem
              </div>
              <p className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                {formatDateTime(sourceEmail.occurred_at)} · {sourceEmail.subject ?? '(sem assunto)'}
              </p>
              {sourceEmail.content && (
                <pre className="text-[12px] whitespace-pre-wrap font-mono rounded-md p-3 max-h-64 overflow-auto" style={{ background: 'var(--muted)', color: 'var(--foreground)' }}>
                  {sourceEmail.content}
                </pre>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={openCompose} disabled={!fh.customer_id} className="gap-1.5">
              <Send className="h-4 w-4" /> Enviar email
            </Button>
            <Button onClick={openOnboarding} disabled={!fh.customer_id} variant="outline" className="gap-1.5">
              <Mail className="h-4 w-4" /> Enviar email de onboarding
            </Button>
            {!fh.customer_id && (
              <span className="text-[11.5px] self-center" style={{ color: 'var(--muted-foreground)' }}>
                Liga primeiro um cliente para enviar emails.
              </span>
            )}
          </div>

          {threadItems.length === 0 && (
            <div className="rounded-xl p-10 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Sem interações ainda.</p>
            </div>
          )}

          {threadItems.map((item) => {
            if (item.kind === 'single') {
              return (
                <InteractionRow
                  key={item.i.id}
                  i={item.i}
                  expanded={expanded[item.i.id] ?? false}
                  summary={summaries[item.i.id]}
                  summarizing={summarizing[item.i.id] ?? false}
                  onToggleExpand={() => setExpanded((e) => ({ ...e, [item.i.id]: !e[item.i.id] }))}
                  onSummarize={() => summarizeEmail(item.i.id, item.i.content, item.i.subject)}
                  onReply={() => openReply(item.i)}
                  onDelete={() => deleteInteraction(item.i.id)}
                />
              )
            }
            // email-thread
            const last = item.messages[item.messages.length - 1]
            return (
              <div key={'th-' + item.subject + '-' + last.id} className="rounded-xl p-4 space-y-2" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--muted-foreground)' }} />
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--foreground)' }}>
                      {item.subject}
                    </p>
                    <span className="text-[11px] shrink-0 rounded-full px-1.5 py-px" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                      {item.messages.length} msgs
                    </span>
                  </div>
                  <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--muted-foreground)' }}>
                    {formatDateTime(last.occurred_at)}
                  </span>
                </div>
                <div className="space-y-1.5 pl-5">
                  {[...item.messages].reverse().map((m) => (
                    <InteractionRow
                      key={m.id}
                      i={m}
                      compact
                      expanded={expanded[m.id] ?? false}
                      summary={summaries[m.id]}
                      summarizing={summarizing[m.id] ?? false}
                      onToggleExpand={() => setExpanded((e) => ({ ...e, [m.id]: !e[m.id] }))}
                      onSummarize={() => summarizeEmail(m.id, m.content, m.subject)}
                      onReply={() => openReply(m)}
                      onDelete={() => deleteInteraction(m.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </TabsContent>
      </Tabs>

      {fh.customer_id && (
        <FollowUpDialog
          open={followUpOpen}
          customerId={fh.customer_id}
          customerName={fh.customers?.name ?? form.name}
          subject={`FH ${fh.shortname}`}
          onClose={() => setFollowUpOpen(false)}
        />
      )}

      {fh.customer_id && (
        <SendEmailDialog
          open={sendOpen}
          customerId={fh.customer_id}
          customerEmail={customerEmailForSend}
          customerName={fh.customers?.name ?? form.name}
          customerCompany={fh.customers?.company ?? null}
          interactions={interactions}
          allEmails={allEmails}
          initialSubject={initialSubjectForSend}
          initialBody={initialBodyForSend}
          onSent={handleSent}
          onClose={() => setSendOpen(false)}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Onboarding checklist
// ────────────────────────────────────────────────────────────────────────────

function OnboardingChecklist({
  emailSentAt, apiKeyReceivedAt, integrationDoneAt, liveAt,
  onSendOnboarding, onMarkIntegrationDone, markingIntegration, canSend,
}: {
  emailSentAt: string | null
  apiKeyReceivedAt: string | null
  integrationDoneAt: string | null
  liveAt: string | null
  onSendOnboarding: () => void
  onMarkIntegrationDone: () => void
  markingIntegration: boolean
  canSend: boolean
}) {
  const steps = [
    { key: 'email',  icon: Mail,    label: 'Email de onboarding enviado',  at: emailSentAt },
    { key: 'api',    icon: Key,     label: 'API key recebida',             at: apiKeyReceivedAt },
    { key: 'int',    icon: Wrench,  label: 'Integração técnica concluída', at: integrationDoneAt },
    { key: 'live',   icon: Rocket,  label: 'Em produção',                  at: liveAt },
  ] as const

  // Find next pending step (first one without `at`)
  const nextIdx = steps.findIndex((s) => !s.at)

  return (
    <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--foreground)' }}>Onboarding</p>
        <div className="flex gap-2">
          {!emailSentAt && (
            <Button onClick={onSendOnboarding} disabled={!canSend} size="sm" className="gap-1.5 h-7 text-[12px]">
              <Send className="h-3.5 w-3.5" /> Enviar email de onboarding
            </Button>
          )}
          {emailSentAt && apiKeyReceivedAt && !integrationDoneAt && (
            <Button onClick={onMarkIntegrationDone} disabled={markingIntegration} variant="outline" size="sm" className="gap-1.5 h-7 text-[12px]">
              {markingIntegration ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
              Marcar integração feita
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {steps.map((s, idx) => {
          const done = !!s.at
          const active = !done && idx === nextIdx
          const Icon = s.icon
          const bg = done   ? 'rgba(45,185,117,0.10)'
                  : active ? 'rgba(91,91,214,0.08)'
                  :          'var(--muted)'
          const fg = done   ? '#1a9e6c'
                  : active ? 'var(--primary)'
                  :          'var(--muted-foreground)'
          const border = done   ? '1px solid rgba(45,185,117,0.25)'
                       : active ? '1px solid rgba(91,91,214,0.3)'
                       :          '1px solid var(--border)'
          return (
            <div key={s.key} className="rounded-lg p-3" style={{ background: bg, border }}>
              <div className="flex items-center gap-1.5">
                {done
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: fg }} />
                  : active
                    ? <Icon className="h-4 w-4 shrink-0" style={{ color: fg }} />
                    : <Lock className="h-3.5 w-3.5 shrink-0" style={{ color: fg }} />
                }
                <p className="text-[11.5px] font-medium leading-tight" style={{ color: fg }}>{s.label}</p>
              </div>
              {done && s.at && (
                <p className="text-[10.5px] mt-1 tabular-nums" style={{ color: 'var(--muted-foreground)' }}>
                  {formatDateTime(s.at)}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Single interaction row — handles email + note + others. Stripped from customer-detail-client.tsx.
// ────────────────────────────────────────────────────────────────────────────

function InteractionRow({
  i, expanded, summary, summarizing, compact = false,
  onToggleExpand, onSummarize, onReply, onDelete,
}: {
  i: Interaction
  expanded: boolean
  summary?: string
  summarizing: boolean
  compact?: boolean
  onToggleExpand: () => void
  onSummarize: () => void
  onReply: () => void
  onDelete: () => void
}) {
  const isEmail   = i.type === 'email'
  const isInbound = i.direction === 'inbound'
  const html      = (i.metadata as Record<string, unknown> | null)?.html as string | undefined
  const text      = i.content ?? ''
  const long      = text.length > 280

  return (
    <div className={compact ? 'rounded-md p-2.5' : 'rounded-xl p-4'} style={{ background: compact ? 'transparent' : 'var(--card)', boxShadow: compact ? 'none' : 'var(--shadow-card)', border: compact ? '1px solid var(--border)' : undefined }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isEmail
            ? (isInbound
                ? <ArrowDownLeft className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--interaction-email)' }} />
                : <ArrowUpRight  className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--status-active)' }} />)
            : <Circle className="h-3 w-3 shrink-0" style={{ color: 'var(--muted-foreground)' }} />
          }
          <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--foreground)' }}>
            {i.subject ?? (i.type === 'note' ? 'Nota' : i.type)}
          </p>
          <span className="text-[10.5px] shrink-0 rounded px-1 py-px uppercase tracking-wide" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
            {i.type}
          </span>
        </div>
        <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--muted-foreground)' }}>
          {formatDateTime(i.occurred_at)}
        </span>
      </div>

      {summary && (
        <div className="mt-2 rounded-md p-2 text-[12px]" style={{ background: 'rgba(91,91,214,0.06)', color: 'var(--foreground)', border: '1px solid rgba(91,91,214,0.2)' }}>
          <p className="text-[10.5px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--primary)' }}>Resumo IA</p>
          {summary}
        </div>
      )}

      {text && (
        <div className="mt-2 text-[12.5px]" style={{ color: 'var(--foreground)' }}>
          {expanded
            ? (html
                ? <EmailHtmlViewer html={html} className="max-h-[420px] overflow-auto" />
                : <pre className="whitespace-pre-wrap font-mono text-[12px] rounded p-2 max-h-96 overflow-auto" style={{ background: 'var(--muted)' }}>{stripHtml(text)}</pre>)
            : <p className="line-clamp-3" style={{ color: 'var(--muted-foreground)' }}>{stripHtml(text).slice(0, 280)}{long ? '…' : ''}</p>
          }
        </div>
      )}

      <div className="mt-2 flex items-center gap-1">
        {text && long && (
          <button onClick={onToggleExpand} className="text-[11px] flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--border)]" style={{ color: 'var(--muted-foreground)' }}>
            {expanded ? <><ChevronUp className="h-3 w-3" /> Recolher</> : <><ChevronDown className="h-3 w-3" /> Expandir</>}
          </button>
        )}
        {isEmail && (
          <button onClick={onSummarize} disabled={summarizing} className="text-[11px] flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--border)] disabled:opacity-50" style={{ color: 'var(--primary)' }}>
            {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Resumir
          </button>
        )}
        {isEmail && isInbound && (
          <button onClick={onReply} className="text-[11px] flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--border)]" style={{ color: 'var(--foreground)' }}>
            <Reply className="h-3 w-3" /> Responder
          </button>
        )}
        <div className="flex-1" />
        <button onClick={onDelete} className="text-[11px] flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--border)]" style={{ color: '#C0272B' }}>
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
