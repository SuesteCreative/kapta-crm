'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Plug, CheckCircle2, UserPlus, CalendarCheck, Save, Loader2,
  Mail, Trash2, Send, Lock, Key, Wrench, Rocket,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { FollowUpDialog } from '@/components/follow-up-dialog'
import { SendEmailDialog, type EmailContact } from '@/components/send-email-dialog'
import { InteractionsTimeline } from '@/components/interactions-timeline'
import {
  FH_STATUS_LABELS, FH_STATUS_ORDER, FH_INVOICING_SYSTEMS, countryFromInvoicingSystem,
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

export function FhIntegrationDetailClient({ fh, sourceEmail, interactions }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    shortname: fh.shortname,
    name: fh.name,
    email: fh.email,
    country: (fh.country ?? '') as '' | FhCountry,
    invoicing_system: fh.invoicing_system ?? '',
    authorized: fh.authorized,
    status: fh.status,
    notes: fh.notes ?? '',
    last_contact_at: fh.last_contact_at ?? '',
  })
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
  // Auto-progression: bump status forward only — never regress past Pedro's manual choice.
  function autoBump(current: FhIntegrationStatus, target: FhIntegrationStatus): FhIntegrationStatus {
    const ci = FH_STATUS_ORDER.indexOf(current)
    const ti = FH_STATUS_ORDER.indexOf(target)
    return ti > ci ? target : current
  }

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
          // fh_api_key intentionally NOT written — data protection,
          // the actual key never passes through this CRM (use checklist toggle instead).
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

  async function markLive() {
    const nowIso = new Date().toISOString()
    setSaving(true)
    try {
      const nextStatus = autoBump(form.status, 'live')
      const { error } = await supabase
        .from('fh_integrations')
        .update({ live_at: nowIso, status: nextStatus, last_contact_at: nowIso })
        .eq('id', fh.id)
      if (error) throw error
      setForm((f) => ({ ...f, status: nextStatus, last_contact_at: nowIso }))
      toast.success('Marcado em produção.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setSaving(false)
    }
  }

  async function unsetLive() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('fh_integrations')
        .update({ live_at: null })
        .eq('id', fh.id)
      if (error) throw error
      toast.success('Produção desmarcada.')
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
      const nextStatus = autoBump(form.status, 'integration_done')
      const { error } = await supabase
        .from('fh_integrations')
        .update({ integration_completed_at: nowIso, status: nextStatus })
        .eq('id', fh.id)
      if (error) throw error
      setForm((f) => ({ ...f, status: nextStatus }))
      toast.success('Integração marcada como concluída.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setMarkingIntegration(false)
    }
  }

  async function unsetIntegrationDone() {
    setMarkingIntegration(true)
    try {
      const { error } = await supabase
        .from('fh_integrations')
        .update({ integration_completed_at: null })
        .eq('id', fh.id)
      if (error) throw error
      toast.success('Integração desmarcada.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setMarkingIntegration(false)
    }
  }

  async function markOnboardingSent() {
    setSaving(true)
    try {
      const nowIso = new Date().toISOString()
      const nextStatus = autoBump(form.status, 'onboarding')
      const { error } = await supabase
        .from('fh_integrations')
        .update({ onboarding_email_sent_at: nowIso, status: nextStatus, last_contact_at: nowIso })
        .eq('id', fh.id)
      if (error) throw error
      setForm((f) => ({ ...f, status: nextStatus, last_contact_at: nowIso }))
      toast.success('Email marcado como enviado.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setSaving(false)
    }
  }

  async function markApiKeyReceived() {
    setSaving(true)
    try {
      const nowIso = new Date().toISOString()
      const nextStatus = autoBump(form.status, 'api_received')
      const { error } = await supabase
        .from('fh_integrations')
        .update({ api_key_received_at: nowIso, status: nextStatus })
        .eq('id', fh.id)
      if (error) throw error
      setForm((f) => ({ ...f, status: nextStatus }))
      toast.success('API key marcada como recebida.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setSaving(false)
    }
  }

  async function unsetApiKeyReceived() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('fh_integrations')
        .update({ api_key_received_at: null })
        .eq('id', fh.id)
      if (error) throw error
      toast.success('API key desmarcada.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setSaving(false)
    }
  }

  async function unsetOnboardingSent() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('fh_integrations')
        .update({ onboarding_email_sent_at: null })
        .eq('id', fh.id)
      if (error) throw error
      toast.success('Email de onboarding desmarcado.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setSaving(false)
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
    // Pull the "FareHarbor Onboarding" template (seed via SQL). If missing, fall back to built-in copy.
    const { data: tpl } = await supabase
      .from('templates')
      .select('subject, body')
      .ilike('name', 'FareHarbor Onboarding')
      .maybeSingle()

    const invoicing = form.invoicing_system?.trim() || 'sistema de faturação'

    const interpolate = (raw: string) => raw
      .replaceAll('{{name}}', form.name)
      .replaceAll('{{shortname}}', form.shortname)
      .replaceAll('{{Sistema de faturação}}', invoicing)
      .replaceAll('{{sistema de faturação}}', invoicing)
      .replaceAll('{{invoicing_system}}', invoicing)

    const fallbackSubject = `Pedido integração FareHarbor — ${form.name}`
    const fallbackBody =
`Bom dia.
Espero que se encontre bem.

O meu nome é Pedro e sou o responsável pelas integrações da Kapta.

Recebi o seu pedido de integração FareHarbor - {{Sistema de faturação}}, e estou aqui para ajudar.
Para iniciar esta integração é necessário pedir o acesso à API do FareHarbor, e ter a conta {{Sistema de faturação}} já ativa, com a ligação à ATCUD feita, série de faturação registada e acesso à chave API.

Como parceiros da FareHarbor, temos um formulário de pedido de API. Basta preencher com os seus dados e a equipa FareHarbor irá contactar diretamente a Kapta com a sua API (geralmente leva entre 1h a 2 dias úteis): https://kapta.pt/fareharbor

Para finalizar a integração peço para marcar uma reunião para podermos ligar tudo em conjunto e tirar quaisquer dúvidas relativas à integração.
Seguem as minhas disponibilidades: https://calendly.com/pedro-kapta/apoio-kapta

Se tiver alguma questão, não hesite em contactar.`

    const subject = interpolate(tpl?.subject ?? fallbackSubject)
    const body    = interpolate(tpl?.body    ?? fallbackBody)

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
    const nowIso = new Date().toISOString()
    try {
      // Every send updates last_contact_at. Onboarding mode additionally
      // bumps the checklist timestamp + auto-progresses status.
      const update: Record<string, unknown> = { last_contact_at: nowIso }
      let nextStatus = form.status
      if (sendMode === 'onboarding') {
        update.onboarding_email_sent_at = nowIso
        nextStatus = autoBump(form.status, 'onboarding')
        if (nextStatus !== form.status) update.status = nextStatus
      }
      await supabase.from('fh_integrations').update(update).eq('id', fh.id)

      // Sync local form state so the visible "Último contacto" input refreshes
      // immediately — useState initial value is frozen, router.refresh alone
      // would not update the input.
      setForm((f) => ({ ...f, last_contact_at: nowIso, status: nextStatus }))
      router.refresh()
    } catch {
      // Send already succeeded; metadata update is best-effort.
    }
  }

  const last_contact_input = form.last_contact_at
    ? new Date(form.last_contact_at).toISOString().slice(0, 16)
    : ''

  const apiKeyReceivedAt = fh.api_key_received_at
  const liveAt = fh.live_at

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
          onClick={openCompose}
          disabled={!fh.customer_id}
          className="gap-1.5"
        >
          <Send className="h-4 w-4" />
          Enviar email
        </Button>
        <Button
          onClick={openOnboarding}
          disabled={!fh.customer_id}
          variant="outline"
          className="gap-1.5"
          title="Enviar email com template de onboarding"
        >
          <Mail className="h-4 w-4" />
          Email onboarding
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
          Follow-up
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
        onMarkEmailSent={markOnboardingSent}
        onUnsetEmailSent={unsetOnboardingSent}
        onMarkApiKey={markApiKeyReceived}
        onUnsetApiKey={unsetApiKeyReceived}
        onMarkIntegrationDone={markIntegrationDone}
        onUnsetIntegrationDone={unsetIntegrationDone}
        onMarkLive={markLive}
        onUnsetLive={unsetLive}
        markingIntegration={markingIntegration}
        saving={saving}
        canSend={!!fh.customer_id}
      />

      {/* Status dropdown — independent of checklist timestamps */}
      <div className="flex items-center gap-2">
        <Label className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Estado de trabalho:</Label>
        <Select
          value={form.status}
          onValueChange={async (v) => {
            const next = v as FhIntegrationStatus
            setForm((f) => ({ ...f, status: next }))
            try {
              await supabase.from('fh_integrations').update({ status: next }).eq('id', fh.id)
              toast.success(`Estado → ${FH_STATUS_LABELS[next]}`)
              router.refresh()
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Erro.')
            }
          }}
        >
          <SelectTrigger className="h-8 w-44 text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(FH_STATUS_LABELS) as FhIntegrationStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{FH_STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-6">
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
                  onChange={(e) => {
                    const v = e.target.value
                    const derived = countryFromInvoicingSystem(v)
                    setForm({
                      ...form,
                      invoicing_system: v,
                      country: form.country || (derived ?? form.country),
                    })
                  }}
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

        {/* Timeline header */}
        <div className="flex items-center gap-2 pt-2">
          <Mail className="h-4 w-4" style={{ color: 'var(--primary)' }} />
          <p className="text-[13px] font-semibold" style={{ color: 'var(--foreground)' }}>
            Timeline · {interactions.length}
          </p>
        </div>

        <InteractionsTimeline
          interactions={interactions}
          onReply={fh.customer_id ? openReply : null}
        />
      </div>

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
  onSendOnboarding, onMarkEmailSent, onUnsetEmailSent,
  onMarkApiKey, onUnsetApiKey,
  onMarkIntegrationDone, onUnsetIntegrationDone,
  onMarkLive, onUnsetLive,
  markingIntegration, saving, canSend,
}: {
  emailSentAt: string | null
  apiKeyReceivedAt: string | null
  integrationDoneAt: string | null
  liveAt: string | null
  onSendOnboarding: () => void
  onMarkEmailSent: () => void
  onUnsetEmailSent: () => void
  onMarkApiKey: () => void
  onUnsetApiKey: () => void
  onMarkIntegrationDone: () => void
  onUnsetIntegrationDone: () => void
  onMarkLive: () => void
  onUnsetLive: () => void
  markingIntegration: boolean
  saving: boolean
  canSend: boolean
}) {
  type Step = {
    key: 'email' | 'api' | 'int' | 'live'
    icon: typeof Mail
    label: string
    at: string | null
    mark?: () => void
    unset?: () => void
    markLabel?: string
    markDisabled?: boolean
    secondaryMark?: () => void
    secondaryLabel?: string
    secondaryDisabled?: boolean
  }
  const steps: Step[] = [
    { key: 'email', icon: Mail,   label: 'Email de onboarding enviado',
      at: emailSentAt, mark: onSendOnboarding, unset: onUnsetEmailSent,
      markLabel: 'Enviar', markDisabled: !canSend,
      secondaryMark: onMarkEmailSent, secondaryLabel: '✓ Já enviei', secondaryDisabled: saving },
    { key: 'api',   icon: Key,    label: 'API key recebida',
      at: apiKeyReceivedAt, mark: onMarkApiKey, unset: onUnsetApiKey,
      markLabel: 'Marcar', markDisabled: saving },
    { key: 'int',   icon: Wrench, label: 'Integração concluída',
      at: integrationDoneAt, mark: onMarkIntegrationDone, unset: onUnsetIntegrationDone,
      markLabel: 'Marcar', markDisabled: markingIntegration },
    { key: 'live',  icon: Rocket, label: 'Em produção',
      at: liveAt, mark: onMarkLive, unset: onUnsetLive,
      markLabel: 'Marcar', markDisabled: saving },
  ]

  return (
    <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
      <p className="text-[13px] font-semibold" style={{ color: 'var(--foreground)' }}>Onboarding</p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {steps.map((s) => {
          const done = !!s.at
          const Icon = s.icon
          const bg = done   ? 'rgba(45,185,117,0.10)' : 'var(--muted)'
          const fg = done   ? '#1a9e6c'                : 'var(--muted-foreground)'
          const border = done ? '1px solid rgba(45,185,117,0.25)' : '1px solid var(--border)'
          return (
            <div key={s.key} className="rounded-lg p-3 space-y-1.5" style={{ background: bg, border }}>
              <div className="flex items-center gap-1.5">
                {done
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: fg }} />
                  : <Icon className="h-4 w-4 shrink-0" style={{ color: fg }} />}
                <p className="text-[11.5px] font-medium leading-tight flex-1" style={{ color: fg }}>{s.label}</p>
              </div>
              {done && s.at && (
                <p className="text-[10.5px] tabular-nums" style={{ color: 'var(--muted-foreground)' }}>
                  {formatDateTime(s.at)}
                </p>
              )}
              {/* Inline toggle: mark when not done; reset when done */}
              <div className="pt-1 flex flex-wrap gap-1">
                {!done && s.mark && (
                  <button
                    onClick={s.mark}
                    disabled={s.markDisabled}
                    className="text-[11px] rounded px-2 py-0.5 hover:bg-[var(--border)] disabled:opacity-50"
                    style={{ color: 'var(--primary)', border: '1px solid var(--border)' }}
                  >
                    {s.markLabel}
                  </button>
                )}
                {!done && s.secondaryMark && (
                  <button
                    onClick={s.secondaryMark}
                    disabled={s.secondaryDisabled}
                    className="text-[11px] rounded px-2 py-0.5 hover:bg-[var(--border)] disabled:opacity-50"
                    style={{ color: 'var(--muted-foreground)' }}
                    title="Marcar como já feito sem enviar"
                  >
                    {s.secondaryLabel}
                  </button>
                )}
                {done && s.unset && (
                  <button
                    onClick={s.unset}
                    className="text-[10.5px] rounded px-2 py-0.5 hover:bg-[var(--border)]"
                    style={{ color: 'var(--muted-foreground)' }}
                    title="Desmarcar"
                  >
                    ↺ Desmarcar
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

