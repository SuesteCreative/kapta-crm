'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Plug, CheckCircle2, UserPlus, CalendarCheck, Save, Loader2,
  Eye, EyeOff, Mail, Trash2,
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
}

export function FhIntegrationDetailClient({ fh, sourceEmail }: Props) {
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
  const [showKey, setShowKey]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [converting, setConverting] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
      // Clean up the source email's back-link so the badge disappears.
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

  const last_contact_input = form.last_contact_at
    ? new Date(form.last_contact_at).toISOString().slice(0, 16)
    : ''

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/fareharbor"
          className="rounded-md p-1.5 hover:bg-[var(--border)]"
          title="Voltar"
        >
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

      {/* Form */}
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

      {fh.customer_id && (
        <FollowUpDialog
          open={followUpOpen}
          customerId={fh.customer_id}
          customerName={fh.customers?.name ?? form.name}
          subject={`FH ${fh.shortname}`}
          onClose={() => setFollowUpOpen(false)}
        />
      )}
    </div>
  )
}
