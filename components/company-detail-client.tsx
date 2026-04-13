'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Building2, Globe, ArrowLeft, Pencil,
  Mail,
  Heart, Users, ExternalLink, Plus, Sparkles,
  Loader2, RefreshCw, MessageCircle, AlertTriangle,
  CheckCircle2, Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EditCompanyDialog } from '@/components/edit-company-dialog'
import { AddInteractionDialog } from '@/components/add-interaction-dialog'
import { AddFollowUpDialog } from '@/components/add-follow-up-dialog'
import { SendEmailDialog } from '@/components/send-email-dialog'
import { cn, STATUS_STYLES, STATUS_LABELS, healthColor, URGENCY_STYLES, formatDateTime, formatDate } from '@/lib/utils'
import { CHANNEL_CONFIG } from '@/lib/channel-config'
import { toast } from 'sonner'
import type { Company, CustomerWithIdentifiers, Interaction } from '@/lib/database.types'

function cleanContent(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => {
      const l = line.trim()
      if (/^--[0-9a-fA-F_=]+/.test(l)) return false
      if (/^Content-(Type|Transfer-Encoding|Disposition):/i.test(l)) return false
      if (/^charset=/i.test(l)) return false
      if (/^boundary=/i.test(l)) return false
      return true
    })
    .join('\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}


type AISummary = { situation: string; urgency: 'critical' | 'high' | 'normal' | 'good'; next_action: string }

interface Props {
  company: Company
  customers: CustomerWithIdentifiers[]
  interactions: Interaction[]
  openFollowUps: number
  openTickets: number
}

// Pick-a-contact inline widget
function ContactPicker({
  customers,
  onPick,
  onCancel,
  label = 'Para qual contacto?',
}: {
  customers: CustomerWithIdentifiers[]
  onPick: (id: string) => void
  onCancel: () => void
  label?: string
}) {
  if (customers.length === 1) { onPick(customers[0].id); return null }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>{label}</span>
      {customers.map((c) => (
        <button
          key={c.id}
          onClick={() => onPick(c.id)}
          className="h-7 px-3 rounded-lg text-[12px] font-medium transition-opacity hover:opacity-80"
          style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)', border: '1px solid rgba(91,91,214,0.2)' }}
        >
          {c.name}
        </button>
      ))}
      <button onClick={onCancel} className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Cancelar</button>
    </div>
  )
}

export function CompanyDetailClient({ company, customers, interactions, openFollowUps, openTickets }: Props) {
  const router = useRouter()
  const [showEdit,           setShowEdit]           = useState(false)
  const [addInteractionFor,  setAddInteractionFor]  = useState<string | null>(null)
  const [addFollowUpFor,     setAddFollowUpFor]     = useState<string | null>(null)
  const [emailFor,           setEmailFor]           = useState<string | null>(null)
  const [picker,             setPicker]             = useState<'interaction' | 'followup' | 'email' | null>(null)
  const [aiSummary,          setAiSummary]          = useState<AISummary | null>(null)
  const [loadingSummary,     setLoadingSummary]     = useState(false)

  const fetchSummary = useCallback(async () => {
    if (interactions.length === 0) return
    setLoadingSummary(true)
    try {
      const cMap = Object.fromEntries(customers.map((c) => [c.id, c.name]))
      const res = await fetch('/api/ai/company-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: company.name,
          contacts: customers.map((c) => ({ name: c.name, status: c.status })),
          interactions: interactions.slice(0, 12).map((i) => ({
            type: i.type,
            direction: i.direction,
            subject: i.subject,
            content: i.content,
            occurred_at: i.occurred_at,
            customer_name: cMap[i.customer_id] ?? '',
          })),
          open_follow_ups: openFollowUps,
          open_tickets: openTickets,
        }),
      })
      const json = await res.json()
      if (json.ok) setAiSummary(json)
    } catch { /* silent */ }
    finally { setLoadingSummary(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.name, company.id, interactions.length, openFollowUps, openTickets])

  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c.name]))

  const [syncingEmails, setSyncingEmails] = useState(false)

  async function syncEmails() {
    setSyncingEmails(true)
    try {
      const res = await fetch('/api/imap/sync-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_ids: customers.map((c) => c.id) }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      toast.success(json.message)
      if (json.synced > 0) router.refresh()
    } catch {
      toast.error('Erro ao sincronizar emails.')
    } finally {
      setSyncingEmails(false)
    }
  }

  // WhatsApp: copy company situation + open WA web
  function sendToWhatsApp() {
    if (!aiSummary) return
    const lines = [
      `*${company.name}*`,
      '',
      aiSummary.situation,
      '',
      `*Próxima ação:* ${aiSummary.next_action}`,
      '',
      `*Contactos:* ${customers.map((c) => c.name).join(', ')}`,
      `*Follow-ups abertos:* ${openFollowUps}`,
      `*Tickets abertos:* ${openTickets}`,
      '',
      `_Kapta CRM · ${formatDate(new Date().toISOString())}_`,
    ]
    navigator.clipboard.writeText(lines.join('\n'))
    toast.success('Mensagem copiada — cola no grupo WhatsApp')
  }

  // Resolve email for a customer
  function primaryEmail(customerId: string): string {
    const c = customers.find((x) => x.id === customerId)
    if (!c) return ''
    const id = c.customer_identifiers.find((i) => i.type === 'email' && i.is_primary)
           ?? c.customer_identifiers.find((i) => i.type === 'email')
    return id?.value ?? ''
  }

  const urgencyStyle = aiSummary ? URGENCY_STYLES[aiSummary.urgency] : URGENCY_STYLES.normal
  const selectedCustomer = emailFor ? customers.find((c) => c.id === emailFor) : null

  return (
    <div className="p-7 max-w-[1000px] mx-auto space-y-6 animate-fade-in">

      {/* Back */}
      <Link
        href="/companies"
        className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-70"
        style={{ color: 'var(--muted-foreground)' }}
      >
        <ArrowLeft className="h-3 w-3" /> Empresas
      </Link>

      {/* Header card */}
      <div className="rounded-xl p-6" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(91,91,214,0.1)' }}>
              <Building2 className="h-6 w-6" style={{ color: 'var(--primary)' }} />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>{company.name}</h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {company.industry && <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{company.industry}</span>}
                {company.domain && (
                  <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    <Globe className="h-3.5 w-3.5" /> {company.domain}
                  </span>
                )}
                {company.website && (
                  <a href={company.website} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--primary)' }}>
                    <ExternalLink className="h-3.5 w-3.5" /> Website
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={syncEmails}
              disabled={syncingEmails}
              title="Sincronizar emails desta empresa"
              className="h-8 w-8 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}
            >
              {syncingEmails
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
            <Button size="sm" variant="outline" onClick={() => setShowEdit(true)}
              className="h-8 gap-1.5 rounded-lg text-[12.5px] font-medium"
              style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
          </div>
        </div>
        {company.notes && (
          <div className="mt-4 p-3 rounded-lg text-sm"
            style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', borderLeft: '3px solid var(--border)' }}>
            {company.notes}
          </div>
        )}
      </div>

      {/* AI Situation Panel */}
      <div
        className="rounded-xl p-5 space-y-4"
        style={{ background: urgencyStyle.bg, border: `1px solid ${urgencyStyle.border}`, boxShadow: 'var(--shadow-card)' }}
      >
        {/* Summary row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 flex-1 min-w-0">
            {loadingSummary
              ? <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" style={{ color: 'var(--muted-foreground)' }} />
              : <Sparkles className="h-4 w-4 mt-0.5 shrink-0" style={{ color: urgencyStyle.dot }} />}
            <div className="flex-1 min-w-0">
              {loadingSummary && !aiSummary && (
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>A analisar situação…</p>
              )}
              {aiSummary && (
                <>
                  <p className="text-sm font-medium leading-snug" style={{ color: 'var(--foreground)' }}>
                    {aiSummary.situation}
                  </p>
                  <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: urgencyStyle.dot }}>
                    <CheckCircle2 className="h-3 w-3" /> {aiSummary.next_action}
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {aiSummary && (
              <span className="text-[11px] font-semibold uppercase rounded-full px-2 py-0.5"
                style={{ background: `${urgencyStyle.dot}20`, color: urgencyStyle.dot }}>
                {urgencyStyle.label}
              </span>
            )}
            <button onClick={fetchSummary} disabled={loadingSummary}
              className="h-7 w-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{ background: 'var(--muted)' }} title="Atualizar resumo">
              <RefreshCw className={cn('h-3.5 w-3.5', loadingSummary && 'animate-spin')} style={{ color: 'var(--muted-foreground)' }} />
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" style={{ color: openFollowUps > 0 ? '#F59E0B' : 'var(--muted-foreground)' }} />
            {openFollowUps} follow-up{openFollowUps !== 1 ? 's' : ''} abertos
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" style={{ color: openTickets > 0 ? '#EF4444' : 'var(--muted-foreground)' }} />
            {openTickets} ticket{openTickets !== 1 ? 's' : ''} abertos
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {customers.length} contacto{customers.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Quick actions row */}
        {picker ? (
          <ContactPicker
            customers={customers}
            onPick={(id) => {
              if (picker === 'interaction') setAddInteractionFor(id)
              if (picker === 'followup')    setAddFollowUpFor(id)
              if (picker === 'email')       setEmailFor(id)
              setPicker(null)
            }}
            onCancel={() => setPicker(null)}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => customers.length === 1 ? setAddFollowUpFor(customers[0].id) : setPicker('followup')}
              className="h-8 gap-1.5 rounded-lg text-[12px] font-medium"
              style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
              <Plus className="h-3.5 w-3.5" /> Follow-up
            </Button>
            <Button size="sm" onClick={() => customers.length === 1 ? setAddInteractionFor(customers[0].id) : setPicker('interaction')}
              variant="outline" className="h-8 gap-1.5 rounded-lg text-[12px] font-medium"
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
              <Plus className="h-3.5 w-3.5" /> Interação
            </Button>
            <Button size="sm" onClick={() => customers.length === 1 ? setEmailFor(customers[0].id) : setPicker('email')}
              variant="outline" className="h-8 gap-1.5 rounded-lg text-[12px] font-medium"
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
              <Mail className="h-3.5 w-3.5" /> Email
            </Button>
            <Button size="sm" onClick={sendToWhatsApp} disabled={!aiSummary}
              variant="outline" className="h-8 gap-1.5 rounded-lg text-[12px] font-medium"
              style={{ background: 'transparent', border: '1px solid rgba(37,211,102,0.4)', color: '#25D366' }}>
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="contacts">
        <TabsList className="rounded-lg p-1 h-auto gap-0.5" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <TabsTrigger value="contacts" className="rounded-md text-[13px] px-4 py-1.5">
            <Users className="h-3.5 w-3.5 mr-1.5" /> Contactos ({customers.length})
          </TabsTrigger>
          <TabsTrigger value="timeline" className="rounded-md text-[13px] px-4 py-1.5">
            Timeline ({interactions.length})
          </TabsTrigger>
        </TabsList>

        {/* CONTACTS */}
        <TabsContent value="contacts" className="mt-5 space-y-2">
          {customers.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Sem contactos. Edita um cliente e seleciona esta empresa.</p>
            </div>
          ) : customers.map((c) => {
            const ss = STATUS_STYLES[c.status]
            return (
              <Link key={c.id} href={`/customers/${c.id}`}
                className="flex items-center gap-4 rounded-xl p-4 transition-opacity hover:opacity-80"
                style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)', display: 'flex' }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>{c.name}</p>
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: ss.bg, color: ss.text }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: ss.dot }} />
                      {STATUS_LABELS[c.status]}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {c.customer_identifiers.slice(0, 3).map((i) => (
                      <span key={i.id} className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>{i.value}</span>
                    ))}
                  </div>
                </div>
                <span className={cn('flex items-center gap-1 text-sm font-medium shrink-0', healthColor(c.health_score))}>
                  <Heart className="h-3.5 w-3.5 fill-current" /> {c.health_score}/5
                </span>
              </Link>
            )
          })}
        </TabsContent>

        {/* TIMELINE */}
        <TabsContent value="timeline" className="mt-5 space-y-3">
          {interactions.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Sem interações registadas para esta empresa.</p>
            </div>
          ) : interactions.map((i) => {
            const ch = CHANNEL_CONFIG[i.type] ?? CHANNEL_CONFIG.note
            const Icon = ch.icon
            return (
              <div key={i.id} className="flex gap-3.5 animate-fade-in">
                <div className="flex flex-col items-center">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: ch.bg }}>
                    <Icon className="h-4 w-4" style={{ color: ch.color }} />
                  </div>
                </div>
                <div className="flex-1 rounded-xl p-4 space-y-1.5" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: ch.color }}>{ch.label}</span>
                        {i.direction && (
                          <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                            {i.direction === 'inbound' ? '↓ recebido' : '↑ enviado'}
                          </span>
                        )}
                        {customerMap[i.customer_id] && (
                          <Link href={`/customers/${i.customer_id}`} onClick={(e) => e.stopPropagation()}
                            className="text-[10px] rounded-full px-1.5 py-0.5 hover:opacity-70 transition-opacity"
                            style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)' }}>
                            {customerMap[i.customer_id]}
                          </Link>
                        )}
                        {i.bubbles_url && (
                          <a href={i.bubbles_url} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] rounded-full px-1.5 py-0.5 hover:opacity-70 transition-opacity flex items-center gap-0.5"
                            style={{ background: 'rgba(139,92,246,0.1)', color: '#8B5CF6' }}>
                            <ExternalLink className="h-2.5 w-2.5" /> Bubbles
                          </a>
                        )}
                      </div>
                      {i.subject && <p className="font-medium text-[14px]" style={{ color: 'var(--foreground)' }}>{i.subject}</p>}
                    </div>
                    <span className="text-[11px] shrink-0" style={{ color: 'var(--muted-foreground)' }}>{formatDateTime(i.occurred_at)}</span>
                  </div>
                  {i.content && (
                    <p className="text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--muted-foreground)' }}>
                      {cleanContent(i.content).slice(0, 300)}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <EditCompanyDialog open={showEdit} company={company} onClose={() => { setShowEdit(false); router.refresh() }} />

      {addInteractionFor && (
        <AddInteractionDialog open customerId={addInteractionFor}
          onClose={() => { setAddInteractionFor(null); router.refresh() }} />
      )}

      {addFollowUpFor && (
        <AddFollowUpDialog
          open
          customerId={addFollowUpFor}
          customerName={customers.find((c) => c.id === addFollowUpFor)?.name}
          customerCompany={company.name}
          interactions={interactions.slice(0, 8).map((i) => ({ type: i.type, direction: i.direction, subject: i.subject, content: i.content, occurred_at: i.occurred_at }))}
          onClose={() => { setAddFollowUpFor(null); router.refresh() }}
        />
      )}

      {emailFor && selectedCustomer && (
        <SendEmailDialog
          open
          customerId={emailFor}
          customerEmail={primaryEmail(emailFor)}
          customerName={selectedCustomer.name}
          customerCompany={company.name}
          allEmails={customers.flatMap((c) =>
            c.customer_identifiers
              .filter((i) => i.type === 'email')
              .map((i) => ({ label: c.name, email: i.value }))
          )}
          onClose={() => { setEmailFor(null); router.refresh() }}
        />
      )}
    </div>
  )
}
