'use client'

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Mail, MailOpen, ArrowDownLeft, ArrowUpRight, Search, RefreshCw, Loader2, X,
  ExternalLink, Paperclip, Reply, ReplyAll, Forward, PenSquare, FileText, Trash2,
  Ticket as TicketIcon, CalendarCheck, AlertTriangle, ChevronRight, Plug, Wrench, Code2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/utils'
import { stripHtml } from '@/lib/html-utils'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { EmailHtmlViewer } from '@/components/email-html-viewer'
import { EmailActionPanel } from '@/components/email-action-panel'
import type { EmailContact } from '@/components/send-email-dialog'
import type { ComposeInitialState } from '@/components/compose-email-dialog'
import type { FhIntegrationParsed } from '@/lib/fh-integration-parser'

// Dialogs lazy-loaded — only fetched when the user opens them.
// Cuts initial JS bundle for /emails by ~tens of KB.
const SendEmailDialog = dynamic(
  () => import('@/components/send-email-dialog').then((m) => ({ default: m.SendEmailDialog })),
  { ssr: false },
)
const ComposeEmailDialog = dynamic(
  () => import('@/components/compose-email-dialog').then((m) => ({ default: m.ComposeEmailDialog })),
  { ssr: false },
)
const HtmlBulkEmailDialog = dynamic(
  () => import('@/components/html-bulk-email-dialog').then((m) => ({ default: m.HtmlBulkEmailDialog })),
  { ssr: false },
)
const TicketBuilderDialog = dynamic(
  () => import('@/components/ticket-builder-dialog').then((m) => ({ default: m.TicketBuilderDialog })),
  { ssr: false },
)
const FollowUpDialog = dynamic(
  () => import('@/components/follow-up-dialog').then((m) => ({ default: m.FollowUpDialog })),
  { ssr: false },
)
const FhIntegrationDialog = dynamic(
  () => import('@/components/fh-integration-dialog').then((m) => ({ default: m.FhIntegrationDialog })),
  { ssr: false },
)
import type { Recipient } from '@/components/recipient-picker'
import type { Interaction, CustomerIdentifier, CustomerWithIdentifiers } from '@/lib/database.types'
import { getPlatform, PLATFORM_STYLES } from '@/lib/platform-detector'

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
  is_read: boolean
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

type InboxFilter = 'all' | 'needs_reply' | 'inbound' | 'outbound'

const FILTER_DEFS: Array<{ key: InboxFilter; label: string }> = [
  { key: 'all',         label: 'Todos' },
  { key: 'needs_reply', label: 'Por responder' },
  { key: 'inbound',     label: 'Recebidos' },
  { key: 'outbound',    label: 'Enviados' },
]

const FILTER_STORAGE_KEY = 'kapta:emails:filter'
const UNREAD_ON_TOP_STORAGE_KEY = 'kapta:emails:unreadOnTop'

interface StaleThread {
  id: string
  customer_id: string
  customer_name: string | null
  customer_company: string | null
  subject: string | null
  occurred_at: string
  direction: 'inbound' | 'outbound'
  age_hours: number
  reason: 'you_owe' | 'waiting_on_customer'
}

function formatBytes(n?: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// Fetches the same shape the server-side page fetches, so the useQuery
// initialData hand-off is a no-op on first paint.
async function fetchEmailsList(limit: number): Promise<EmailRow[]> {
  const fullSelect = `
    id, customer_id, direction, subject, occurred_at, metadata, is_read,
    customers ( id, name, company, customer_identifiers ( type, value ) )
  `
  const { data, error } = await supabase
    .from('interactions')
    .select(fullSelect)
    .eq('type', 'email')
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as EmailRow[]
}

const PAGE_SIZE = 200

export const EMAILS_LIST_QUERY_KEY = ['emails', 'list'] as const

export function EmailsClient({ emails: initialEmails }: { emails: EmailRow[] }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [listLimit, setListLimit]       = useState(PAGE_SIZE)
  const { data: emails = initialEmails, isFetching: listFetching } = useQuery({
    queryKey: [...EMAILS_LIST_QUERY_KEY, listLimit] as const,
    queryFn: () => fetchEmailsList(listLimit),
    initialData: listLimit === PAGE_SIZE ? initialEmails : undefined,
    // initialData was server-rendered in this render — keep it fresh for the
    // current SSR window, then let staleTime (30s, from Providers) drive
    // background refetches.
    initialDataUpdatedAt: Date.now(),
  })
  const [search, setSearch]             = useState('')
  // Server-side search results (whole table, any age) — used instead of the
  // locally-loaded page whenever the user is actively searching.
  const [serverResults, setServerResults] = useState<EmailRow[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [filter, setFilter]             = useState<InboxFilter>('all')
  const [syncing, setSyncing]           = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [readIds, setReadIds]           = useState<Set<string>>(new Set())
  const [unreadIds, setUnreadIds]       = useState<Set<string>>(new Set())
  const [unreadOnTop, setUnreadOnTop]   = useState(false)
  const [ticketOpen, setTicketOpen]     = useState(false)
  const [ticketCtx, setTicketCtx]       = useState<{ customer: CustomerWithIdentifiers; interactions: Interaction[]; sourceId: string } | null>(null)
  const [ticketLoading, setTicketLoading] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [followUpCtx, setFollowUpCtx]   = useState<{ customer_id: string; customer_name: string; subject: string } | null>(null)
  const [fhOpen, setFhOpen]             = useState(false)
  const [fhCtx, setFhCtx]               = useState<{ sourceId: string; prefill: FhIntegrationParsed | null } | null>(null)
  const [staleThreads, setStaleThreads] = useState<StaleThread[]>([])
  const [staleDismissed, setStaleDismissed] = useState(false)
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [replyOpen, setReplyOpen]       = useState(false)
  const [replyCtx, setReplyCtx]         = useState<ReplyContext | null>(null)
  const [replyLoading, setReplyLoading] = useState(false)
  const [composeOpen, setComposeOpen]   = useState(false)
  const [htmlBulkOpen, setHtmlBulkOpen] = useState(false)
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null)
  const [composeInitial, setComposeInitial] = useState<ComposeInitialState | null>(null)
  const [selectedContent, setSelectedContent] = useState<string | null>(null)
  const [selectedHtml, setSelectedHtml]       = useState<string | null>(null)
  const [contentLoading, setContentLoading]   = useState(false)
  const [contentError, setContentError]       = useState(false)
  const [drafts, setDrafts]             = useState<DraftRow[]>([])
  const [draftsOpen, setDraftsOpen]     = useState(false)
  const draftsRef                       = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/email/drafts')
      .then((r) => r.json())
      .then((json) => { if (json.ok) setDrafts(json.drafts ?? []) })
      .catch(() => { /* silent */ })
  }, [composeOpen]) // refresh when compose dialog closes (in case a draft was saved or sent)

  // Restore filter + stale-banner-dismissed + unread-on-top state from localStorage
  useEffect(() => {
    const f = localStorage.getItem(FILTER_STORAGE_KEY)
    if (f === 'all' || f === 'needs_reply' || f === 'inbound' || f === 'outbound') setFilter(f)
    const dismissedDay = localStorage.getItem('kapta:stale:dismissed')
    if (dismissedDay === new Date().toISOString().slice(0, 10)) setStaleDismissed(true)
    if (localStorage.getItem(UNREAD_ON_TOP_STORAGE_KEY) === '1') setUnreadOnTop(true)
  }, [])

  useEffect(() => {
    localStorage.setItem(FILTER_STORAGE_KEY, filter)
  }, [filter])

  useEffect(() => {
    localStorage.setItem(UNREAD_ON_TOP_STORAGE_KEY, unreadOnTop ? '1' : '0')
  }, [unreadOnTop])

  // Debounced server-side search across the WHOLE table (not just the loaded
  // page). Empty / <2 chars → fall back to the local list.
  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      setServerResults(null)
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    let cancelled = false
    const t = setTimeout(() => {
      fetch(`/api/emails/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return
          if (json.ok) setServerResults(json.emails ?? [])
          else { setServerResults([]); toast.error('Erro na pesquisa', { description: json.error }) }
        })
        .catch((e) => { if (!cancelled) { setServerResults([]); toast.error('Erro na pesquisa', { description: String(e) }) } })
        .finally(() => { if (!cancelled) setSearchLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search])

  // Fetch stale threads on mount
  useEffect(() => {
    fetch('/api/inbox/stale-threads')
      .then((r) => r.json())
      .then((json) => { if (json.ok) setStaleThreads(json.threads ?? []) })
      .catch(() => { /* silent */ })
  }, [])

  function dismissStaleBanner() {
    setStaleDismissed(true)
    localStorage.setItem('kapta:stale:dismissed', new Date().toISOString().slice(0, 10))
  }

  async function openTicket(email: EmailRow) {
    setTicketLoading(true)
    try {
      const [interactionRes, customerRes] = await Promise.all([
        supabase.from('interactions').select('*').eq('id', email.id).maybeSingle(),
        supabase.from('customers').select('*, customer_identifiers(*)').eq('id', email.customer_id).maybeSingle(),
      ])
      if (!customerRes.data) { toast.error('Cliente não encontrado.'); return }
      const interaction = (interactionRes.data ?? null) as Interaction | null
      setTicketCtx({
        customer: customerRes.data as CustomerWithIdentifiers,
        interactions: interaction ? [interaction] : [],
        sourceId: email.id,
      })
      setTicketOpen(true)
    } catch {
      toast.error('Erro ao carregar ticket.')
    } finally {
      setTicketLoading(false)
    }
  }

  function openFollowUp(email: EmailRow) {
    setFollowUpCtx({
      customer_id: email.customer_id,
      customer_name: email.customers?.name ?? '',
      subject: email.subject ?? '',
    })
    setFollowUpOpen(true)
  }

  function openFhIntegration(email: EmailRow) {
    const parsed = (email.metadata?.fh_parsed as FhIntegrationParsed | undefined) ?? null
    setFhCtx({ sourceId: email.id, prefill: parsed })
    setFhOpen(true)
  }

  const [fhFlagLoading, setFhFlagLoading] = useState(false)
  async function toggleFhFlag(email: EmailRow, action: 'flag' | 'unflag') {
    setFhFlagLoading(true)
    try {
      const res = await fetch('/api/fareharbor/flag-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interaction_id: email.id, action }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro')
      toast.success(action === 'flag' ? 'Marcado como pedido FH' : 'Pedido FH desmarcado')
      queryClient.invalidateQueries({ queryKey: EMAILS_LIST_QUERY_KEY })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atualizar.')
    } finally {
      setFhFlagLoading(false)
    }
  }

  function selectStaleThread(t: StaleThread) {
    setSelectedId(t.id)
    dismissStaleBanner()
  }

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
      const json = await fetch(`/api/emails/${email.id}/body`)
        .then((r) => r.json())
        .catch(() => null)
      content = (json?.ok ? (json.content as string | null) : null) ?? null
    }
    setComposeDraftId(null)
    setComposeInitial(buildForwardState(email, content))
    setComposeOpen(true)
  }

  // Lazy-fetch full body + html when an email is selected; also mark as read.
  // Body is read via a server route (service role) because `interactions` has
  // RLS enabled with no policy — a direct browser query returns zero rows and
  // would silently render every email as "(sem corpo)".
  useEffect(() => {
    if (!selectedId) {
      setSelectedContent(null)
      setSelectedHtml(null)
      setContentError(false)
      return
    }
    let cancelled = false
    setContentLoading(true)
    setContentError(false)
    setSelectedContent(null)
    setSelectedHtml(null)
    fetch(`/api/emails/${selectedId}/body`)
      .then(async (r) => {
        if (cancelled) return
        const json = await r.json().catch(() => null)
        if (!r.ok || !json?.ok) {
          setContentError(true)
          return
        }
        setSelectedContent((json.content as string | null) ?? null)
        setSelectedHtml((json.html as string | null) ?? null)
      })
      .catch(() => { if (!cancelled) setContentError(true) })
      .then(() => { if (!cancelled) setContentLoading(false) })

    // Mark as read on selection (idempotent + optimistic)
    const target = [...emails, ...(serverResults ?? [])].find((e) => e.id === selectedId)
    if (target && !target.is_read && !readIds.has(selectedId) && !unreadIds.has(selectedId)) {
      const idToMark = selectedId
      setReadIds((prev) => new Set([...prev, idToMark]))
      setReadState(idToMark, true).catch((e) => console.error('mark-read failed', e))
    }
    return () => { cancelled = true }
  }, [selectedId])

  // Effective read state: server value, override with optimistic sets.
  function isReadEffective(e: EmailRow): boolean {
    if (unreadIds.has(e.id)) return false
    if (readIds.has(e.id))   return true
    return e.is_read
  }

  // Persist read state via server route — `interactions` RLS blocks the
  // browser's anon role, so a direct update silently no-op'd.
  function setReadState(id: string, isRead: boolean) {
    return fetch(`/api/emails/${id}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_read: isRead }),
    })
  }

  async function toggleUnread(id: string, ev: ReactMouseEvent) {
    ev.stopPropagation()
    const email = [...emails, ...(serverResults ?? [])].find((e) => e.id === id)
    if (!email) return
    const currentlyRead = isReadEffective(email)
    if (currentlyRead) {
      setReadIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      setUnreadIds((prev) => new Set([...prev, id]))
      await setReadState(id, false)
    } else {
      setUnreadIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      setReadIds((prev) => new Set([...prev, id]))
      await setReadState(id, true)
    }
  }

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
      const histJson = await fetch(`/api/emails/history?customerId=${email.customer_id}`)
        .then((r) => r.json())
        .catch(() => null)
      const interactions = histJson?.ok ? (histJson.interactions as Interaction[]) : []

      setReplyCtx({
        customerId: email.customer_id,
        customerName: email.customers?.name ?? '',
        customerCompany: email.customers?.company ?? null,
        customerEmail,
        initialSubject,
        interactions,
        allEmails: emailIds.map((i) => ({ label: i.value, email: i.value })),
      })
      setReplyOpen(true)
    } finally {
      setReplyLoading(false)
    }
  }

  async function dismissEmail(id: string) {
    setDismissedIds((prev) => new Set([...prev, id]))
    if (selectedId === id) setSelectedId(null)
    await fetch(`/api/emails/${id}/dismiss`, { method: 'POST' })
      .catch((e) => console.error('dismiss failed', e))
  }

  async function syncNow(silent = false) {
    // Fire-and-forget via Inngest dispatch — same path as the sidebar button.
    // The <JobToaster /> handles the progress bar + completion toast, and
    // we invalidate the emails query when the sync completes (handled in
    // <JobToaster /> on the status='done' event via router.refresh()).
    setSyncing(true)
    try {
      const res = await fetch('/api/imap/sync-dispatch', { method: 'POST' })
      const data = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok || !data.ok) {
        throw new Error((data.error as string) ?? `HTTP ${res.status}`)
      }
      localStorage.setItem('lastEmailSync', String(Date.now()))
      if (!silent) {
        toast.info('A sincronizar email…', {
          description: 'Vais ver uma barra de progresso quando começar.',
          duration: 4000,
        })
      }
    } catch (e) {
      if (!silent) toast.error('Não consegui iniciar o sync', { description: String(e), duration: Infinity })
    } finally {
      setSyncing(false)
    }
  }

  // Auto-sync while the emails page is open. The only server-side cron is daily
  // (vercel.json: 0 7 * * *), so without this new mail wouldn't show until the
  // next morning or a manual click. Pedro lives on this page, so sync on mount,
  // on focus, and every few minutes — silent, throttled via lastEmailSync.
  const syncNowRef = useRef(syncNow)
  syncNowRef.current = syncNow
  useEffect(() => {
    // Cadence matters: the 3-minute auto-sync (plus a per-sync full-table
    // scan, since removed) exhausted the Supabase free-tier disk IO budget on
    // 2026-06-11 and took the DB down. 15 min keeps the inbox fresh enough;
    // the manual "Sincronizar" button covers the "I want it now" case.
    const THROTTLE_MS = 15 * 60 * 1000
    const REFRESH_THROTTLE_MS = 15 * 60 * 1000
    // The list normally refreshes via <JobToaster /> when a sync job
    // completes, but that depends on the Supabase realtime websocket, which
    // can die silently (laptop sleep, network change). Refresh the server
    // snapshot on the same cadence as the auto-sync so the list never goes
    // stale even with a dead channel. Starts at "now" to skip the redundant
    // refresh on mount — the page just rendered fresh data.
    let lastRefresh = Date.now()
    const maybeSync = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (Date.now() - lastRefresh >= REFRESH_THROTTLE_MS) {
        lastRefresh = Date.now()
        router.refresh()
      }
      const last = Number(localStorage.getItem('lastEmailSync') ?? 0)
      if (Date.now() - last < THROTTLE_MS) return
      syncNowRef.current(true) // silent
    }
    maybeSync()
    const id = setInterval(maybeSync, REFRESH_THROTTLE_MS)
    window.addEventListener('focus', maybeSync)
    document.addEventListener('visibilitychange', maybeSync)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', maybeSync)
      document.removeEventListener('visibilitychange', maybeSync)
    }
  }, [router])

  // When the user is searching, the list comes from the server (whole table,
  // any age). Otherwise it's the locally-loaded page.
  const isSearching = search.trim().length >= 2
  const sourceEmails = isSearching && serverResults ? serverResults : emails

  // Pre-compute "needs reply": inbound emails with no later outbound for the same customer.
  const lastOutboundByCustomer = new Map<string, string>()
  for (const e of sourceEmails) {
    if (e.direction !== 'outbound') continue
    const prev = lastOutboundByCustomer.get(e.customer_id)
    if (!prev || e.occurred_at > prev) lastOutboundByCustomer.set(e.customer_id, e.occurred_at)
  }
  function needsReply(e: EmailRow): boolean {
    if (e.direction !== 'inbound') return false
    const lastOut = lastOutboundByCustomer.get(e.customer_id)
    return !lastOut || lastOut < e.occurred_at
  }

  const baseVisible = sourceEmails.filter((e) => e.metadata?.is_spam !== true && !dismissedIds.has(e.id))
  const needsReplyCount = baseVisible.filter(needsReply).length
  const unreadCount     = baseVisible.filter((e) => !isReadEffective(e)).length

  const filtered = baseVisible.filter((e) => {
    // Search is applied server-side when isSearching, so don't re-filter here.
    if (filter === 'all')         return true
    if (filter === 'inbound')     return e.direction === 'inbound'
    if (filter === 'outbound')    return e.direction === 'outbound'
    if (filter === 'needs_reply') return needsReply(e)
    return true
  })

  if (unreadOnTop) {
    filtered.sort((a, b) => {
      const aRead = isReadEffective(a) ? 1 : 0
      const bRead = isReadEffective(b) ? 1 : 0
      if (aRead !== bRead) return aRead - bRead
      return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    })
  }

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
            {isSearching
              ? `${baseVisible.length} resultado${baseVisible.length === 1 ? '' : 's'} para "${search.trim()}"`
              : `${emails.length - dismissedIds.size} emails carregados`}
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

          <button
            onClick={() => setHtmlBulkOpen(true)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-opacity hover:opacity-70"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
            title="Envio bulk HTML com BCC GDPR-safe"
          >
            <Code2 className="h-3.5 w-3.5" />
            Bulk HTML
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
            className="pl-9 pr-9 h-9 w-[280px] text-sm rounded-lg"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
            placeholder="Pesquisar email, cliente, assunto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {searchLoading
            ? <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin" style={{ color: 'var(--muted-foreground)' }} />
            : search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-70"
                title="Limpar pesquisa"
              >
                <X className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
              </button>
            )}
        </div>

        <div className="flex gap-1.5">
          {FILTER_DEFS.map(({ key, label }) => {
            const active = filter === key
            const showBadge = key === 'needs_reply' && needsReplyCount > 0
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className="rounded-full px-3 py-1 text-[12px] font-medium transition-all flex items-center gap-1.5"
                style={{
                  background: active ? 'var(--foreground)' : 'var(--card)',
                  color: active ? 'var(--card)' : 'var(--muted-foreground)',
                  border: `1px solid ${active ? 'var(--foreground)' : 'var(--border)'}`,
                }}
              >
                {label}
                {showBadge && (
                  <span
                    className="rounded-full px-1.5 text-[10px] font-bold tabular-nums"
                    style={{
                      background: active ? 'var(--card)' : 'rgba(239,68,68,0.12)',
                      color: active ? 'var(--foreground)' : 'rgb(220,38,38)',
                    }}
                  >
                    {needsReplyCount}
                  </span>
                )}
              </button>
            )
          })}

          <button
            onClick={() => setUnreadOnTop((v) => !v)}
            className="rounded-full px-3 py-1 text-[12px] font-medium transition-all flex items-center gap-1.5"
            title={unreadOnTop ? 'Ordem cronológica' : 'Não lidos no topo'}
            style={{
              background: unreadOnTop ? 'var(--foreground)' : 'var(--card)',
              color: unreadOnTop ? 'var(--card)' : 'var(--muted-foreground)',
              border: `1px solid ${unreadOnTop ? 'var(--foreground)' : 'var(--border)'}`,
            }}
          >
            <Mail className="h-3 w-3" />
            Não lidos no topo
            {unreadCount > 0 && (
              <span
                className="rounded-full px-1.5 text-[10px] font-bold tabular-nums"
                style={{
                  background: unreadOnTop ? 'var(--card)' : 'rgba(59,130,246,0.12)',
                  color: unreadOnTop ? 'var(--foreground)' : 'rgb(37,99,235)',
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Stale-thread banner */}
      {!staleDismissed && staleThreads.length > 0 && (
        <div
          className="rounded-xl px-4 py-3"
          style={{
            background: 'rgba(245,158,11,0.06)',
            border: '1px solid rgba(245,158,11,0.25)',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color: 'rgb(180,83,9)' }}>
              <AlertTriangle className="h-3.5 w-3.5" />
              {staleThreads.length} {staleThreads.length === 1 ? 'thread parada' : 'threads paradas'}
            </div>
            <button
              onClick={dismissStaleBanner}
              className="text-[11px] hover:opacity-70"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Dispensar hoje
            </button>
          </div>
          <div className="space-y-1">
            {staleThreads.slice(0, 5).map((t) => (
              <button
                key={t.id}
                onClick={() => selectStaleThread(t)}
                className="w-full flex items-center justify-between gap-3 px-2 py-1.5 rounded-md text-left hover:bg-[rgba(245,158,11,0.08)]"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0"
                    style={{
                      background: t.reason === 'you_owe' ? 'rgba(239,68,68,0.12)' : 'rgba(91,91,214,0.12)',
                      color: t.reason === 'you_owe' ? 'rgb(220,38,38)' : 'var(--primary)',
                    }}
                  >
                    {t.reason === 'you_owe' ? 'Deves resposta' : 'À espera'}
                  </span>
                  <span className="text-[12px] truncate" style={{ color: 'var(--foreground)' }}>
                    {t.customer_name ?? '—'}
                    {t.customer_company && <span style={{ color: 'var(--muted-foreground)' }}> · {t.customer_company}</span>}
                    <span style={{ color: 'var(--muted-foreground)' }}> · {t.subject ?? '(sem assunto)'}</span>
                  </span>
                </div>
                <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--muted-foreground)' }}>
                  {t.age_hours < 24 ? `${Math.floor(t.age_hours)}h` : `${Math.floor(t.age_hours / 24)}d`}
                </span>
                <ChevronRight className="h-3 w-3 shrink-0" style={{ color: 'var(--muted-foreground)' }} />
              </button>
            ))}
          </div>
        </div>
      )}

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
              {searchLoading
                ? 'A pesquisar…'
                : isSearching
                  ? `Nenhum email encontrado para "${search.trim()}".`
                  : emails.length === 0
                    ? 'Nenhum email sincronizado. Clica em Sincronizar.'
                    : 'Nenhum resultado.'}
            </div>
          )}

          {filtered.map((email) => {
            const isInbound   = email.direction === 'inbound'
            const isSelected  = email.id === selectedId
            const isUnread    = !isReadEffective(email)
            const attachments = (email.metadata?.attachments as Attachment[] | undefined) ?? []

            return (
              <div
                key={email.id}
                className="group flex gap-3 px-4 py-3 cursor-pointer row-hover relative"
                style={{
                  borderBottom: '1px solid var(--border)',
                  background: isSelected ? 'var(--border)' : undefined,
                }}
                onClick={() => setSelectedId(email.id)}
              >
                {/* Unread indicator strip */}
                {isUnread && (
                  <div
                    aria-hidden
                    className="absolute left-0 top-0 bottom-0 w-[3px]"
                    style={{ background: 'rgb(37,99,235)' }}
                  />
                )}

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
                    <span
                      className="text-[13px] truncate"
                      style={{
                        color: 'var(--foreground)',
                        fontWeight: isUnread ? 700 : 500,
                      }}
                    >
                      {email.customers?.name ?? '—'}
                    </span>
                    <span className="text-[11px] shrink-0 tabular-nums" style={{ color: 'var(--muted-foreground)' }}>
                      {formatDateTime(email.occurred_at)}
                    </span>
                  </div>

                  <p
                    className="text-[12.5px] mt-0.5 truncate"
                    style={{
                      color: 'var(--foreground)',
                      fontWeight: isUnread ? 600 : 400,
                    }}
                  >
                    {email.subject ?? '(sem assunto)'}
                  </p>

                  <div className="flex items-center gap-2 mt-0.5">
                    {attachments.length > 0 && (
                      <Paperclip className="h-3 w-3 shrink-0" style={{ color: 'var(--muted-foreground)' }} />
                    )}
                    {email.metadata?.fh_integration_request === true && !email.metadata?.fh_integration_id && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium shrink-0"
                        style={{ background: 'rgba(91,91,214,0.12)', color: 'var(--primary)' }}
                        title="Pedido de integração FareHarbor detectado"
                      >
                        <Plug className="h-2.5 w-2.5" />
                        FH
                      </span>
                    )}
                    {email.metadata?.fh_troubleshoot_hint === true && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium shrink-0"
                        style={{ background: 'rgba(245,158,11,0.15)', color: '#B45309' }}
                        title={`Possível troubleshoot — keyword: ${(email.metadata?.fh_troubleshoot_match as string | undefined) ?? '?'}`}
                      >
                        <Wrench className="h-2.5 w-2.5" />
                        troubleshoot?
                      </span>
                    )}
                    {email.metadata?.fh_integration_id != null && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium shrink-0"
                        style={{ background: 'rgba(45,185,117,0.1)', color: 'var(--status-active)' }}
                        title="Integração FareHarbor já criada"
                      >
                        <Plug className="h-2.5 w-2.5" />
                        FH ✓
                      </span>
                    )}
                    {Array.isArray(email.metadata?.detected_platforms) &&
                      (email.metadata.detected_platforms as string[]).map((key) => {
                        const p = getPlatform(key)
                        if (!p) return null
                        const style = PLATFORM_STYLES[p.category]
                        return (
                          <span
                            key={key}
                            className="inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium shrink-0"
                            style={{ background: style.bg, color: style.text }}
                            title={`Detectado: ${p.label}`}
                          >
                            {p.label}
                          </span>
                        )
                      })}
                  </div>
                </div>

                {/* Hover actions: mark unread/read + dismiss */}
                <div className="shrink-0 self-center flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(ev) => toggleUnread(email.id, ev)}
                    className="rounded p-1 hover:bg-[var(--border)]"
                    title={isUnread ? 'Marcar como lido' : 'Marcar como não lido'}
                  >
                    {isUnread
                      ? <MailOpen className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                      : <Mail     className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />}
                  </button>
                  <button
                    onClick={(ev) => { ev.stopPropagation(); dismissEmail(email.id) }}
                    className="rounded p-1 hover:bg-[var(--border)]"
                    title="Arquivar email"
                  >
                    <X className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                  </button>
                </div>
              </div>
            )
          })}

          {/* Load more — only when browsing (not searching) and the page is full,
              so older emails beyond the loaded window are reachable. */}
          {!isSearching && emails.length >= listLimit && (
            <button
              onClick={() => setListLimit((n) => n + PAGE_SIZE)}
              disabled={listFetching}
              className="w-full px-5 py-3 text-[12.5px] font-medium hover:bg-[var(--border)] disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ color: 'var(--primary)' }}
            >
              {listFetching
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> A carregar…</>
                : `Carregar mais ${PAGE_SIZE}`}
            </button>
          )}
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
                      onClick={() => openTicket(selected)}
                      disabled={ticketLoading}
                      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium hover:opacity-70 disabled:opacity-40"
                      style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                      title="Criar ticket a partir deste email"
                    >
                      {ticketLoading
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <TicketIcon className="h-3 w-3" />}
                      Ticket
                    </button>
                    {selected.metadata?.fh_integration_id ? (
                      <button
                        onClick={() => router.push(`/fareharbor/${selected.metadata!.fh_integration_id as string}`)}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium hover:opacity-70"
                        style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)', border: '1px solid rgba(91,91,214,0.3)' }}
                        title="Abrir integração FareHarbor"
                      >
                        <Plug className="h-3 w-3" />
                        Ver FH
                      </button>
                    ) : selected.metadata?.fh_integration_request === true ? (
                      <>
                        <button
                          onClick={() => openFhIntegration(selected)}
                          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium hover:opacity-70"
                          style={{ background: 'rgba(91,91,214,0.08)', color: 'var(--primary)', border: '1px solid rgba(91,91,214,0.25)' }}
                          title="Criar integração FareHarbor a partir deste email"
                        >
                          <Plug className="h-3 w-3" />
                          FH
                        </button>
                        <button
                          onClick={() => toggleFhFlag(selected, 'unflag')}
                          disabled={fhFlagLoading}
                          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium hover:opacity-70 disabled:opacity-40"
                          style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
                          title="Remover este email da lista 'Por contactar' do FareHarbor"
                        >
                          {fhFlagLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Desmarcar FH'}
                        </button>
                      </>
                    ) : isInbound && (
                      <button
                        onClick={() => toggleFhFlag(selected, 'flag')}
                        disabled={fhFlagLoading}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium hover:opacity-70 disabled:opacity-40"
                        style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                        title="Marcar este email como pedido de integração FareHarbor (aparece em 'Por contactar')"
                      >
                        {fhFlagLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
                        Marcar FH
                      </button>
                    )}
                    <button
                      onClick={() => openFollowUp(selected)}
                      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium hover:opacity-70"
                      style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                      title="Criar follow-up"
                    >
                      <CalendarCheck className="h-3 w-3" />
                      Follow-up
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
                    : contentError
                    ? <div className="text-[12px]" style={{ color: 'var(--destructive, #dc2626)' }}>Falha ao carregar a mensagem. Recarrega ou tenta de novo.</div>
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
          onSent={() => router.refresh()}
          onClose={() => setReplyOpen(false)}
        />
      )}

      <ComposeEmailDialog
        open={composeOpen}
        draftId={composeDraftId}
        initialState={composeInitial}
        onClose={() => { setComposeOpen(false); setComposeDraftId(null); setComposeInitial(null) }}
      />

      <HtmlBulkEmailDialog
        open={htmlBulkOpen}
        onClose={() => setHtmlBulkOpen(false)}
      />

      {ticketCtx && (
        <TicketBuilderDialog
          open={ticketOpen}
          customer={ticketCtx.customer}
          interactions={ticketCtx.interactions}
          sourceInteractionId={ticketCtx.sourceId}
          onClose={() => { setTicketOpen(false); setTicketCtx(null) }}
        />
      )}

      {followUpCtx && (
        <FollowUpDialog
          open={followUpOpen}
          customerId={followUpCtx.customer_id}
          customerName={followUpCtx.customer_name}
          subject={followUpCtx.subject}
          onClose={() => { setFollowUpOpen(false); setFollowUpCtx(null) }}
        />
      )}

      {fhCtx && (
        <FhIntegrationDialog
          open={fhOpen}
          sourceInteractionId={fhCtx.sourceId}
          prefill={fhCtx.prefill}
          onClose={() => { setFhOpen(false); setFhCtx(null) }}
        />
      )}
    </div>
  )
}
