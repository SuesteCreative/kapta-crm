'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mail, ArrowDownLeft, ArrowUpRight, Search, RefreshCw, Loader2, X,
  ExternalLink, Paperclip, Reply, ReplyAll, Forward, PenSquare, FileText, Trash2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/utils'
import { stripHtml } from '@/lib/html-utils'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { SendEmailDialog, type EmailContact } from '@/components/send-email-dialog'
import { EmailHtmlViewer } from '@/components/email-html-viewer'
import { EmailActionPanel } from '@/components/email-action-panel'
import { ComposeEmailDialog, type ComposeInitialState } from '@/components/compose-email-dialog'
import type { Recipient } from '@/components/recipient-picker'
import type { Interaction, CustomerIdentifier } from '@/lib/database.types'

const OWN_DOMAIN = 'kapta.pt'

function parseAddressList(s: string | undefined | null): string[] {
  if (!s) return []
  // Strip "Name <email>" pairs and split
  const matches = s.match(/[\w.+-]+@[\w-]+\.[\w.]+/g)
  return matches ?? []
}

function buildReplyAllState(email: EmailRow): ComposeInitialState {
  const matched = email.metadata?.matched_email as string | undefined
  const customer = email.customers
  const customerEmail = matched
    ?? customer?.customer_identifiers?.find((i) => i.type === 'email')?.value
    ?? ''

  const ccRaw = email.metadata?.cc as string | null | undefined
  const toRaw = email.metadata?.to as string | null | undefined

  const ccCandidates = [...parseAddressList(ccRaw), ...parseAddressList(toRaw)]
    .filter((e) => !e.toLowerCase().includes(OWN_DOMAIN))
    .filter((e) => e.toLowerCase() !== customerEmail.toLowerCase())

  const seen = new Set<string>()
  const ccUnique = ccCandidates.filter((e) => {
    const key = e.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const to: Recipient[] = customerEmail
    ? [{ email: customerEmail, customer_id: email.customer_id, name: customer?.name, company: customer?.company ?? null }]
    : []

  const cc: Recipient[] = ccUnique.map((e) => ({ email: e }))

  const rawSubject = email.subject ?? ''
  const subject = /^re:/i.test(rawSubject) ? rawSubject : (rawSubject ? `Re: ${rawSubject}` : '')

  return { to, cc, subject }
}

function buildForwardState(email: EmailRow, fetchedContent: string | null): ComposeInitialState {
  const rawSubject = email.subject ?? ''
  const subject = /^fwd?:/i.test(rawSubject) ? rawSubject : (rawSubject ? `Fwd: ${rawSubject}` : 'Fwd: ')

  const sender = email.customers
  const senderName = sender ? `${sender.name}${sender.company ? ` (${sender.company})` : ''}` : '—'
  const date = new Date(email.occurred_at).toLocaleString('pt-PT')
  const quoted = fetchedContent ? stripHtml(fetchedContent).slice(0, 4000) : ''

  const body = `\n\n----- Mensagem encaminhada -----\nDe: ${senderName}\nData: ${date}\nAssunto: ${rawSubject}\n\n${quoted}`

  return { subject, body }
}

interface Attachment {
  name?: string
  mime?: string
  size?: number
  url?: string
  ai_summary?: string
}

interface EmailRow {
  id: string
  customer_id: string
  direction: string | null
  subject: string | null
  occurred_at: string
  metadata: Record<string, unknown> | null
  customers: {
    id: string
    name: string
    company: string | null
    customer_identifiers?: CustomerIdentifier[]
  } | null
}

interface ReplyContext {
  customerId: string
  customerName: string
  customerCompany: string | null
  customerEmail: string
  initialSubject: string
  interactions: Interaction[]
  allEmails: EmailContact[]
}

interface DraftRow {
  id: string
  primary_customer_id: string | null
  to_recipients: Array<{ email: string; name?: string }> | null
  subject: string | null
  body: string | null
  prompt: string | null
  updated_at: string
}

function draftLabel(d: DraftRow): string {
  if (d.subject && d.subject.trim()) return d.subject.trim()
  if (d.body && d.body.trim()) return d.body.trim().slice(0, 60) + (d.body.length > 60 ? '…' : '')
  if (d.prompt && d.prompt.trim()) return `(prompt) ${d.prompt.trim().slice(0, 50)}${d.prompt.length > 50 ? '…' : ''}`
  return '(rascunho vazio)'
}

function draftRecipients(d: DraftRow): string {
  const list = d.to_recipients ?? []
  if (list.length === 0) return 'sem destinatários'
  if (list.length === 1) return list[0].email
  return `${list[0].email} +${list.length - 1}`
}

const DIRECTION_FILTERS = [
  { key: null,       label: 'Todos' },
  { key: 'inbound',  label: 'Recebidos' },
  { key: 'outbound', label: 'Enviados' },
]

function formatBytes(n?: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function EmailsClient({ emails }: { emails: EmailRow[] }) {
  const router = useRouter()
  const [search, setSearch]             = useState('')
  const [dirFilter, setDirFilter]       = useState<string | null>(null)
  const [syncing, setSyncing]           = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [replyOpen, setReplyOpen]       = useState(false)
  const [replyCtx, setReplyCtx]         = useState<ReplyContext | null>(null)
  const [replyLoading, setReplyLoading] = useState(false)
  const [composeOpen, setComposeOpen]   = useState(false)
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null)
  const [composeInitial, setComposeInitial] = useState<ComposeInitialState | null>(null)
  const [selectedContent, setSelectedContent] = useState<string | null>(null)
  const [selectedHtml, setSelectedHtml]       = useState<string | null>(null)
  const [contentLoading, setContentLoading]   = useState(false)
  const [drafts, setDrafts]             = useState<DraftRow[]>([])
  const [draftsOpen, setDraftsOpen]     = useState(false)
  const draftsRef                       = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/email/drafts')
      .then((r) => r.json())
      .then((json) => { if (json.ok) setDrafts(json.drafts ?? []) })
      .catch(() => { /* silent */ })
  }, [composeOpen]) // refresh when compose dialog closes (in case a draft was saved or sent)

  useEffect(() => {
    if (!draftsOpen) return
    function onClick(ev: MouseEvent) {
      if (draftsRef.current && !draftsRef.current.contains(ev.target as Node)) {
        setDraftsOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [draftsOpen])

  async function deleteDraft(id: string) {
    try {
      const res = await fetch(`/api/email/drafts/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setDrafts((prev) => prev.filter((d) => d.id !== id))
      toast.success('Rascunho apagado')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao apagar.')
    }
  }

  function openDraft(id: string) {
    setComposeDraftId(id)
    setComposeOpen(true)
    setDraftsOpen(false)
  }

  function openNewCompose() {
    setComposeDraftId(null)
    setComposeInitial(null)
    setComposeOpen(true)
  }

  function openReplyAll(email: EmailRow) {
    setComposeDraftId(null)
    setComposeInitial(buildReplyAllState(email))
    setComposeOpen(true)
  }

  async function openForward(email: EmailRow) {
    let content: string | null = selectedContent
    if (!content || email.id !== selectedId) {
      const { data } = await supabase
        .from('interactions')
        .select('content')
        .eq('id', email.id)
        .maybeSingle()
      content = (data?.content as string | null) ?? null
    }
    setComposeDraftId(null)
    setComposeInitial(buildForwardState(email, content))
    setComposeOpen(true)
  }

  // Lazy-fetch full body + html when an email is selected
  useEffect(() => {
    if (!selectedId) {
      setSelectedContent(null)
      setSelectedHtml(null)
      return
    }
    let cancelled = false
    setContentLoading(true)
    setSelectedContent(null)
    setSelectedHtml(null)
    supabase
      .from('interactions')
      .select('content, metadata')
      .eq('id', selectedId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const meta = data?.metadata as Record<string, unknown> | null
        setSelectedContent((data?.content as string | null) ?? null)
        setSelectedHtml((meta?.html as string | null | undefined) ?? null)
      })
      .then(() => { if (!cancelled) setContentLoading(false) })
    return () => { cancelled = true }
  }, [selectedId])

  async function openReply(email: EmailRow) {
    const matched = email.metadata?.matched_email as string | undefined
    const identifiers = email.customers?.customer_identifiers ?? []
    const emailIds = identifiers.filter((i) => i.type === 'email')
    const customerEmail = matched ?? emailIds[0]?.value ?? ''

    if (!customerEmail) {
      toast.error('Cliente sem email registado.')
      return
    }

    const rawSubject = email.subject ?? ''
    const initialSubject = /^re:/i.test(rawSubject) ? rawSubject : (rawSubject ? `Re: ${rawSubject}` : '')

    setReplyLoading(true)
    try {
      const { data: interactions } = await supabase
        .from('interactions')
        .select('*')
        .eq('customer_id', email.customer_id)
        .order('occurred_at', { ascending: false })
        .limit(20)

      setReplyCtx({
        customerId: email.customer_id,
        customerName: email.customers?.name ?? '',
        customerCompany: email.customers?.company ?? null,
        customerEmail,
        initialSubject,
        interactions: (interactions ?? []) as Interaction[],
        allEmails: emailIds.map((i) => ({ label: i.value, email: i.value })),
      })
      setReplyOpen(true)
    } finally {
      setReplyLoading(false)
    }
  }

  async function dismissEmail(id: string, currentMetadata: Record<string, unknown> | null) {
    setDismissedIds((prev) => new Set([...prev, id]))
    if (selectedId === id) setSelectedId(null)
    await supabase.from('interactions')
      .update({ metadata: { ...(currentMetadata ?? {}), is_spam: true } })
      .eq('id', id)
  }

  async function syncNow(silent = false) {
    setSyncing(true)
    try {
      const res  = await fetch('/api/imap/sync')
      const text = await res.text()
      let data: Record<string, unknown>
      try { data = JSON.parse(text) } catch { throw new Error(`Resposta inválida (HTTP ${res.status}): ${text.slice(0, 200)}`) }
      localStorage.setItem('lastEmailSync', String(Date.now()))
      if (data.ok) {
        if ((data.synced as number) > 0) {
          if (!silent) toast.success(`${data.synced} email(s) importados · ${data.created_leads ?? 0} novos leads`, { duration: Infinity })
          router.refresh()
        } else {
          if (!silent) toast.success('Sem novos emails', { duration: Infinity })
        }
      } else {
        if (!silent) toast.error('Erro ao sincronizar', { description: data.error as string, duration: Infinity })
      }
    } catch (e) {
      if (!silent) toast.error('Erro ao sincronizar', { description: String(e), duration: Infinity })
    } finally {
      setSyncing(false)
    }
  }

  const filtered = emails.filter((e) => {
    const q = search.toLowerCase()
    const matchesSearch =
      !search ||
      (e.subject ?? '').toLowerCase().includes(q) ||
      (e.customers?.name ?? '').toLowerCase().includes(q) ||
      (e.customers?.company ?? '').toLowerCase().includes(q)
    const matchesDir = !dirFilter || e.direction === dirFilter
    const notSpam = e.metadata?.is_spam !== true
    return matchesSearch && matchesDir && notSpam && !dismissedIds.has(e.id)
  })

  const selected = selectedId ? filtered.find((e) => e.id === selectedId) ?? null : null

  return (
    <div className="p-7 max-w-[1400px] mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Emails
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {emails.length - dismissedIds.size} emails sincronizados
          </p>
        </div>
        <div className="flex items-center gap-2 relative">
          <button
            onClick={openNewCompose}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-opacity hover:opacity-70"
            style={{
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              border: '1px solid var(--primary)',
            }}
          >
            <PenSquare className="h-3.5 w-3.5" />
            Novo email
          </button>

          {drafts.length > 0 && (
            <div ref={draftsRef} className="relative">
              <button
                onClick={() => setDraftsOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-opacity hover:opacity-70"
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                }}
              >
                <FileText className="h-3.5 w-3.5" />
                Rascunhos
                <span
                  className="rounded-full px-1.5 text-[10.5px] font-bold"
                  style={{ background: 'rgba(91,91,214,0.15)', color: 'var(--primary)' }}
                >
                  {drafts.length}
                </span>
              </button>

              {draftsOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-[340px] z-30 rounded-lg overflow-hidden"
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-card)',
                    maxHeight: 360,
                    overflowY: 'auto',
                  }}
                >
                  {drafts.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-start gap-2 px-3 py-2 row-hover"
                      style={{ borderBottom: '1px solid var(--border)' }}
                    >
                      <button
                        onClick={() => openDraft(d.id)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--foreground)' }}>
                          {draftLabel(d)}
                        </p>
                        <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--muted-foreground)' }}>
                          {draftRecipients(d)} · {formatDateTime(d.updated_at)}
                        </p>
                      </button>
                      <button
                        onClick={(ev) => { ev.stopPropagation(); deleteDraft(d.id) }}
                        className="opacity-50 hover:opacity-100 p-1 rounded shrink-0"
                        title="Apagar rascunho"
                      >
                        <Trash2 className="h-3 w-3" style={{ color: 'var(--muted-foreground)' }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => syncNow()}
            disabled={syncing}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--muted-foreground)',
            }}
          >
            {syncing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            {syncing ? 'A sincronizar…' : 'Sincronizar'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
            style={{ color: 'var(--muted-foreground)' }}
          />
          <Input
            className="pl-9 h-9 w-[280px] text-sm rounded-lg"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
            placeholder="Pesquisar assunto, cliente…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-1.5">
          {DIRECTION_FILTERS.map(({ key, label }) => (
            <button
              key={String(key)}
              onClick={() => setDirFilter(key)}
              className="rounded-full px-3 py-1 text-[12px] font-medium transition-all"
              style={{
                background: dirFilter === key ? 'var(--foreground)' : 'var(--card)',
                color: dirFilter === key ? 'var(--card)' : 'var(--muted-foreground)',
                border: `1px solid ${dirFilter === key ? 'var(--foreground)' : 'var(--border)'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Split: list + preview */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,520px)_1fr] gap-5 items-start">

        {/* List */}
        <div
          className="rounded-xl overflow-hidden divide-y"
          style={{
            background: 'var(--card)',
            boxShadow: 'var(--shadow-card)',
            border: '1px solid var(--border)',
          }}
        >
          {filtered.length === 0 && (
            <div className="px-5 py-12 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
              {emails.length === 0 ? 'Nenhum email sincronizado. Clica em Sincronizar.' : 'Nenhum resultado.'}
            </div>
          )}

          {filtered.map((email) => {
            const isInbound   = email.direction === 'inbound'
            const isSelected  = email.id === selectedId
            const attachments = (email.metadata?.attachments as Attachment[] | undefined) ?? []

            return (
              <div
                key={email.id}
                className="group flex gap-3 px-4 py-3 cursor-pointer row-hover"
                style={{
                  borderBottom: '1px solid var(--border)',
                  background: isSelected ? 'var(--border)' : undefined,
                }}
                onClick={() => setSelectedId(email.id)}
              >
                {/* Direction icon */}
                <div
                  className="mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: isInbound ? 'rgba(59,130,246,0.1)' : 'rgba(45,185,117,0.1)',
                  }}
                >
                  {isInbound
                    ? <ArrowDownLeft className="h-3 w-3" style={{ color: 'var(--interaction-email)' }} />
                    : <ArrowUpRight  className="h-3 w-3" style={{ color: 'var(--status-active)' }} />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-[13px] truncate" style={{ color: 'var(--foreground)' }}>
                      {email.customers?.name ?? '—'}
                    </span>
                    <span className="text-[11px] shrink-0 tabular-nums" style={{ color: 'var(--muted-foreground)' }}>
                      {formatDateTime(email.occurred_at)}
                    </span>
                  </div>

                  <p className="text-[12.5px] mt-0.5 truncate" style={{ color: 'var(--foreground)' }}>
                    {email.subject ?? '(sem assunto)'}
                  </p>

                  {attachments.length > 0 && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <Paperclip className="h-3 w-3 shrink-0" style={{ color: 'var(--muted-foreground)' }} />
                    </div>
                  )}
                </div>

                {/* Dismiss */}
                <button
                  onClick={(ev) => { ev.stopPropagation(); dismissEmail(email.id, email.metadata) }}
                  className="shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-[var(--border)]"
                  title="Arquivar email"
                >
                  <X className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                </button>
              </div>
            )
          })}
        </div>

        {/* Preview panel */}
        <div
          className="rounded-xl lg:sticky lg:top-6 overflow-hidden"
          style={{
            background: 'var(--card)',
            boxShadow: 'var(--shadow-card)',
            border: '1px solid var(--border)',
            maxHeight: 'calc(100vh - 3rem)',
          }}
        >
          {!selected ? (
            <div
              className="flex items-center justify-center h-[400px] text-sm"
              style={{ color: 'var(--muted-foreground)' }}
            >
              <div className="text-center space-y-2">
                <Mail className="h-6 w-6 mx-auto opacity-50" />
                <p>Seleciona um email para pré-visualizar</p>
              </div>
            </div>
          ) : (() => {
            const isInbound   = selected.direction === 'inbound'
            const matched     = selected.metadata?.matched_email as string | undefined
            const cc          = selected.metadata?.cc  as string | null | undefined
            const bcc         = selected.metadata?.bcc as string | null | undefined
            const attachments = (selected.metadata?.attachments as Attachment[] | undefined) ?? []
            const htmlBody    = selectedHtml ?? undefined
            const body        = selectedContent ? stripHtml(selectedContent) : ''

            return (
              <div className="flex flex-col" style={{ maxHeight: 'calc(100vh - 3rem)' }}>
                {/* Panel header */}
                <div
                  className="px-5 py-4 flex items-start justify-between gap-3 shrink-0"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <div className="min-w-0 flex-1">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium mb-2"
                      style={{
                        background: isInbound ? 'rgba(59,130,246,0.08)' : 'rgba(45,185,117,0.08)',
                        color: isInbound ? 'var(--interaction-email)' : 'var(--status-active)',
                      }}
                    >
                      <Mail className="h-2.5 w-2.5" />
                      {isInbound ? 'Recebido' : 'Enviado'}
                    </span>
                    <h2 className="text-[15px] font-semibold leading-snug" style={{ color: 'var(--foreground)' }}>
                      {selected.subject ?? '(sem assunto)'}
                    </h2>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openReply(selected)}
                      disabled={replyLoading}
                      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium hover:opacity-70 disabled:opacity-40"
                      style={{ background: 'var(--foreground)', color: 'var(--card)' }}
                      title="Responder"
                    >
                      {replyLoading
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Reply className="h-3 w-3" />}
                      Responder
                    </button>
                    <button
                      onClick={() => openReplyAll(selected)}
                      className="rounded-md p-1.5 hover:bg-[var(--border)]"
                      title="Responder a todos"
                    >
                      <ReplyAll className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                    </button>
                    <button
                      onClick={() => openForward(selected)}
                      className="rounded-md p-1.5 hover:bg-[var(--border)]"
                      title="Encaminhar"
                    >
                      <Forward className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                    </button>
                    <button
                      onClick={() => router.push(`/customers/${selected.customer_id}`)}
                      className="rounded p-1.5 hover:bg-[var(--border)]"
                      title="Abrir cliente"
                    >
                      <ExternalLink className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                    </button>
                    <button
                      onClick={() => setSelectedId(null)}
                      className="rounded p-1.5 hover:bg-[var(--border)]"
                      title="Fechar"
                    >
                      <X className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                    </button>
                  </div>
                </div>

                {/* Meta */}
                <div
                  className="px-5 py-3 text-[12px] space-y-1 shrink-0"
                  style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
                >
                  <div className="flex gap-2">
                    <span className="w-12 shrink-0">{isInbound ? 'De' : 'Para'}:</span>
                    <span style={{ color: 'var(--foreground)' }}>
                      {selected.customers?.name ?? '—'}
                      {selected.customers?.company && ` · ${selected.customers.company}`}
                      {matched && <span className="ml-1" style={{ color: 'var(--muted-foreground)' }}>&lt;{matched}&gt;</span>}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-12 shrink-0">Data:</span>
                    <span style={{ color: 'var(--foreground)' }}>{formatDateTime(selected.occurred_at)}</span>
                  </div>
                  {cc && (
                    <div className="flex gap-2">
                      <span className="w-12 shrink-0">CC:</span>
                      <span style={{ color: 'var(--foreground)' }}>{cc}</span>
                    </div>
                  )}
                  {bcc && (
                    <div className="flex gap-2">
                      <span className="w-12 shrink-0">BCC:</span>
                      <span style={{ color: 'var(--foreground)' }}>{bcc}</span>
                    </div>
                  )}
                </div>

                {/* AI action suggestions */}
                {!contentLoading && selectedContent !== null && (
                  <EmailActionPanel
                    interactionId={selected.id}
                    customerId={selected.customer_id}
                    customerName={selected.customers?.name ?? ''}
                    customerCompany={selected.customers?.company ?? null}
                    email={{
                      direction: (selected.direction as 'inbound' | 'outbound' | null) ?? null,
                      subject: selected.subject,
                      content: selectedContent,
                      occurred_at: selected.occurred_at,
                    }}
                  />
                )}

                {/* Attachments */}
                {attachments.length > 0 && (
                  <div
                    className="px-5 py-3 shrink-0"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--muted-foreground)' }}>
                      Anexos ({attachments.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((a, idx) => (
                        <a
                          key={idx}
                          href={a.url ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] hover:opacity-70"
                          style={{ background: 'var(--border)', color: 'var(--foreground)' }}
                        >
                          <Paperclip className="h-3 w-3" />
                          {a.name ?? 'anexo'}
                          {a.size && <span style={{ color: 'var(--muted-foreground)' }}>· {formatBytes(a.size)}</span>}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Body */}
                <div className="px-5 py-4 overflow-auto flex-1">
                  {contentLoading
                    ? <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>A carregar mensagem…</div>
                    : <EmailHtmlViewer html={htmlBody} text={body} />}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {replyCtx && (
        <SendEmailDialog
          open={replyOpen}
          customerId={replyCtx.customerId}
          customerEmail={replyCtx.customerEmail}
          customerName={replyCtx.customerName}
          customerCompany={replyCtx.customerCompany}
          interactions={replyCtx.interactions}
          allEmails={replyCtx.allEmails}
          initialSubject={replyCtx.initialSubject}
          onClose={() => setReplyOpen(false)}
        />
      )}

      <ComposeEmailDialog
        open={composeOpen}
        draftId={composeDraftId}
        initialState={composeInitial}
        onClose={() => { setComposeOpen(false); setComposeDraftId(null); setComposeInitial(null) }}
      />
    </div>
  )
}
