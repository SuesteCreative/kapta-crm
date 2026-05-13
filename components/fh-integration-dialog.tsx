'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plug, CheckCircle2, AlertTriangle, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import {
  FH_INVOICING_SYSTEMS, FH_STATUS_LABELS, FH_COUNTRY_ORDER, FH_COUNTRY_LABELS,
  countryFromInvoicingSystem,
  type FhCountry, type FhIntegrationStatus,
} from '@/lib/database.types'
import type { FhIntegrationParsed } from '@/lib/fh-integration-parser'
import {
  findCustomerByEmail, deriveCompanyFromSender, isPersonalDomain,
  shortnameToCompanyGuess, resolveOrCreateCustomerForFh,
  type FindCustomerResult, type DerivedCompany,
} from '@/lib/customer-resolver'

interface Props {
  open: boolean
  sourceInteractionId: string | null
  prefill: FhIntegrationParsed | null
  onClose: () => void
  onCreated?: (id: string) => void
}

interface FormState {
  shortname: string
  name: string
  email: string
  country: '' | FhCountry
  invoicing_system: string
  authorized: boolean
  status: FhIntegrationStatus
  notes: string
}

const EMPTY: FormState = {
  shortname: '', name: '', email: '', country: '',
  invoicing_system: '', authorized: false,
  status: 'new', notes: '',
}

type ResolverState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'existing'; match: FindCustomerResult }
  | { kind: 'business-auto'; derived: DerivedCompany }
  | { kind: 'personal-needs-approval'; guess: string; domain: string | null }
  | { kind: 'no-email' }

export function FhIntegrationDialog({ open, sourceInteractionId, prefill, onClose, onCreated }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [resolver, setResolver] = useState<ResolverState>({ kind: 'idle' })
  const [companyOverride, setCompanyOverride] = useState('')
  const [editingBusiness, setEditingBusiness] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm({
      shortname: prefill?.shortname ?? '',
      name: prefill?.name ?? '',
      email: prefill?.email ?? '',
      country: prefill?.country ?? '',
      invoicing_system: prefill?.invoicingSystem ?? '',
      authorized: prefill?.authorization ?? false,
      status: 'new',
      notes: '',
    })
    setResolver({ kind: 'idle' })
    setCompanyOverride('')
    setEditingBusiness(false)
  }, [open, prefill])

  // Re-resolve whenever email or name changes (debounced via simple effect; small payload).
  useEffect(() => {
    if (!open) return
    const email = form.email.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setResolver({ kind: 'no-email' })
      return
    }

    let cancelled = false
    setResolver({ kind: 'loading' })

    ;(async () => {
      const existing = await findCustomerByEmail(email)
      if (cancelled) return
      if (existing) {
        setResolver({ kind: 'existing', match: existing })
        return
      }

      if (isPersonalDomain(email)) {
        const guess = shortnameToCompanyGuess(form.shortname || email.split('@')[0])
        setResolver({ kind: 'personal-needs-approval', guess, domain: null })
        setCompanyOverride((prev) => prev || guess)
        return
      }

      const derived = deriveCompanyFromSender(email, form.name)
      if (derived) {
        setResolver({ kind: 'business-auto', derived })
        setCompanyOverride((prev) => prev || derived.name)
      } else {
        const guess = shortnameToCompanyGuess(form.shortname || email.split('@')[0])
        setResolver({ kind: 'personal-needs-approval', guess, domain: null })
        setCompanyOverride((prev) => prev || guess)
      }
    })()

    return () => { cancelled = true }
  }, [open, form.email, form.name, form.shortname])

  const submitDisabled = useMemo(() => {
    if (loading) return true
    if (!form.shortname.trim() || !form.name.trim() || !form.email.trim()) return true
    if (resolver.kind === 'personal-needs-approval' && !companyOverride.trim()) return true
    return false
  }, [loading, form.shortname, form.name, form.email, resolver, companyOverride])

  async function handleSave() {
    if (!form.shortname.trim()) { toast.error('Shortname obrigatório.'); return }
    if (!form.name.trim())      { toast.error('Nome obrigatório.'); return }
    if (!form.email.trim())     { toast.error('Email obrigatório.'); return }

    setLoading(true)
    try {
      // 1. Resolve / create customer + company
      let customerId: string | null = null
      try {
        const override =
          resolver.kind === 'personal-needs-approval'
            ? { name: companyOverride.trim(), domain: null }
            : resolver.kind === 'business-auto' && editingBusiness && companyOverride.trim()
              ? { name: companyOverride.trim(), domain: resolver.derived.domain }
              : null

        const result = await resolveOrCreateCustomerForFh({
          email: form.email,
          contactName: form.name,
          companyOverride: override,
        })
        customerId = result.customer_id
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erro ao resolver cliente.'
        toast.error(msg)
        setLoading(false)
        return
      }

      // 2. Insert fh_integration with the resolved customer_id
      const { data, error } = await supabase
        .from('fh_integrations')
        .insert({
          shortname: form.shortname.trim(),
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          country: form.country || null,
          invoicing_system: form.invoicing_system.trim() || null,
          authorized: form.authorized,
          status: form.status,
          notes: form.notes.trim() || null,
          customer_id: customerId,
          source_interaction_id: sourceInteractionId,
          last_contact_at: null,
        })
        .select('id')
        .single()

      if (error) throw error
      const newId = data!.id as string

      // 3. Back-link the source email so the badge becomes "Ver FH"
      if (sourceInteractionId) {
        const { data: existing } = await supabase
          .from('interactions')
          .select('metadata')
          .eq('id', sourceInteractionId)
          .maybeSingle()
        const merged = { ...(existing?.metadata ?? {}), fh_integration_id: newId }
        await supabase
          .from('interactions')
          .update({ metadata: merged })
          .eq('id', sourceInteractionId)
      }

      toast.success('Integração FareHarbor criada!')
      onCreated?.(newId)
      onClose()
      router.push(`/fareharbor/${newId}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao guardar.'
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
        toast.error('Já existe uma integração com este shortname.')
      } else {
        toast.error(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" style={{ color: 'var(--primary)' }} />
            Nova integração FareHarbor
            {prefill && Object.keys(prefill).length > 0 && (
              <span
                className="text-[11px] font-normal rounded-full px-2 py-0.5"
                style={{ background: 'rgba(45,185,117,0.1)', color: 'var(--status-active)' }}
              >
                Detectado do email
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>FareHarbor Shortname *</Label>
              <Input
                value={form.shortname}
                onChange={(e) => setForm({ ...form, shortname: e.target.value })}
                placeholder="shortname"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Andrew Zino"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="andrew.zino@naturemeetings.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>País</Label>
              <Select
                value={form.country || undefined}
                onValueChange={(v) => setForm({ ...form, country: v as FhCountry })}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {FH_COUNTRY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>{FH_COUNTRY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Client / Company resolution panel */}
          <ResolverPanel
            state={resolver}
            companyOverride={companyOverride}
            setCompanyOverride={setCompanyOverride}
            editingBusiness={editingBusiness}
            setEditingBusiness={setEditingBusiness}
          />

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
                    // Auto-fill country if it's empty AND invoicing system implies one
                    country: form.country || (derived ?? form.country),
                  })
                }}
                placeholder="IGEST, Moloni, Holded…"
                list="fh-invoicing-systems"
              />
              <datalist id="fh-invoicing-systems">
                {FH_INVOICING_SYSTEMS.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as FhIntegrationStatus })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(FH_STATUS_LABELS) as FhIntegrationStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{FH_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="fh-authorized"
              type="checkbox"
              checked={form.authorized}
              onChange={(e) => setForm({ ...form, authorized: e.target.checked })}
              className="h-4 w-4 rounded"
            />
            <Label htmlFor="fh-authorized" className="cursor-pointer">
              Autorização confirmada
            </Label>
          </div>

          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notas iniciais sobre este parceiro…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={submitDisabled}>
            {loading ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />A guardar…</> : 'Criar integração'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResolverPanel({
  state, companyOverride, setCompanyOverride, editingBusiness, setEditingBusiness,
}: {
  state: ResolverState
  companyOverride: string
  setCompanyOverride: (v: string) => void
  editingBusiness: boolean
  setEditingBusiness: (v: boolean) => void
}) {
  if (state.kind === 'no-email') return null

  if (state.kind === 'loading') {
    return (
      <div className="rounded-lg p-3 flex items-center gap-2 text-[12px]" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        A procurar cliente…
      </div>
    )
  }

  if (state.kind === 'existing') {
    return (
      <div
        className="rounded-lg p-3 flex items-start gap-2"
        style={{ background: 'rgba(45,185,117,0.08)', border: '1px solid rgba(45,185,117,0.25)' }}
      >
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--status-active)' }} />
        <div className="flex-1">
          <p className="text-[12.5px] font-medium" style={{ color: 'var(--status-active)' }}>
            Cliente já existente
          </p>
          <p className="text-[12px]" style={{ color: 'var(--foreground)' }}>
            {state.match.name}{state.match.company ? ` · ${state.match.company}` : ''}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            A integração será ligada a este cliente automaticamente.
          </p>
        </div>
      </div>
    )
  }

  if (state.kind === 'business-auto') {
    return (
      <div
        className="rounded-lg p-3 space-y-2"
        style={{ background: 'rgba(45,185,117,0.08)', border: '1px solid rgba(45,185,117,0.25)' }}
      >
        <div className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--status-active)' }} />
          <div className="flex-1">
            <p className="text-[12.5px] font-medium" style={{ color: 'var(--status-active)' }}>
              Empresa detectada · {state.derived.domain ?? 'sem domínio'}
            </p>
            <p className="text-[12px]" style={{ color: 'var(--foreground)' }}>
              {editingBusiness ? 'A editar empresa antes de criar.' : state.derived.name}
            </p>
          </div>
          {!editingBusiness && (
            <button
              type="button"
              onClick={() => { setEditingBusiness(true); setCompanyOverride(state.derived.name) }}
              className="text-[11px] underline hover:opacity-70 shrink-0"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <Pencil className="h-3 w-3 inline mr-0.5" /> Editar
            </button>
          )}
        </div>
        {editingBusiness && (
          <Input
            value={companyOverride}
            onChange={(e) => setCompanyOverride(e.target.value)}
            placeholder="Nome da empresa"
            className="text-[13px]"
          />
        )}
      </div>
    )
  }

  if (state.kind === 'personal-needs-approval') {
    return (
      <div
        className="rounded-lg p-3 space-y-2"
        style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: '#B45309' }} />
          <div className="flex-1">
            <p className="text-[12.5px] font-medium" style={{ color: '#B45309' }}>
              Confirmar empresa
            </p>
            <p className="text-[11.5px]" style={{ color: 'var(--muted-foreground)' }}>
              Email pessoal — não foi possível detetar a empresa. Confirma ou edita o nome:
            </p>
          </div>
        </div>
        <Input
          value={companyOverride}
          onChange={(e) => setCompanyOverride(e.target.value)}
          placeholder={state.guess}
          className="text-[13px]"
        />
      </div>
    )
  }

  return null
}
