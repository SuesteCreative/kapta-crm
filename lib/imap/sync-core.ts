// IMAP sync core — extracted from app/api/imap/sync/route.ts so it can be
// called directly from both the route handler (Vercel cron) AND the Inngest
// function (which chunks the work via continuation events so we stay under
// Vercel Hobby's 60s function limit).
//
// Chunking: the body-fetch loop stops after `maxEmails` rows have been
// processed (counts inserts + skips for unknown/automated/spam — anything
// that consumed a fetch). If there are more candidate UIDs left when we
// stop, `hasMore` is true so the caller can dispatch a continuation event.

import { ImapFlow } from 'imapflow'
import { simpleParser, ParsedMail } from 'mailparser'
import { createServiceClient } from '@/lib/supabase'
import { analyzeAttachment } from '@/lib/analyze-attachment'
import {
  isFhIntegrationEmail, isFhIntegrationBody, parseFhIntegrationEmail,
  isFhConfirmationEmail, isFhConfirmationBody, parseFhConfirmationEmail,
} from '@/lib/fh-integration-parser'
import {
  isCalendlyRecapEmail, parseCalendlyRecap, isHostAttendee, nameMatches,
} from '@/lib/calendly-recap-parser'
import { extractForwardedSender } from '@/lib/email-utils'
import { isSpamSender } from '@/lib/spam-filter'
import { detectPlatforms } from '@/lib/platform-detector'
import { randomUUID } from 'crypto'

const ATTACH_BUCKET = 'email-attachments'
const ATTACH_MAX_BYTES   = 15 * 1024 * 1024
const ATTACH_MAX_ANALYZE =  5 * 1024 * 1024

type AttachmentMeta = { name: string; mime: string; size: number; url: string | null; ai_summary: string }

const AUTOMATED_PREFIXES = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'notifications', 'notification', 'mailer-daemon', 'postmaster',
  'bounce', 'bounces', 'unsubscribe', 'newsletter', 'marketing',
  'automatico', 'automacao', 'robot', 'autoresponder', 'auto-reply',
  'autoreply', 'info-noreply', 'support-noreply', 'updates', 'alerts',
]

function isAutomatedSender(email: string): boolean {
  const local = email.split('@')[0].toLowerCase().replace(/\+.*$/, '')
  return AUTOMATED_PREFIXES.some((p) => local === p || local.startsWith(p + '-') || local.startsWith(p + '_'))
}

// A forwarded message — by subject prefix (Fwd:/Fw:/Enc:) or a forwarded-block
// marker in the body. Used to keep team forwards out of the "unknown" drop bin.
const FORWARD_SUBJECT_RE = /^\s*(?:fwd?|fw|enc)\s*[:\]]/i
const FORWARD_BODY_RE = /(begin forwarded message|-{2,}\s*forwarded message|forwarded message\s*-{2,}|mensagem reencaminhada|in[íi]cio da mensagem reencaminhada)/i
function isForwardedEmail(subject: string | null | undefined, body: string | null | undefined): boolean {
  if (subject && FORWARD_SUBJECT_RE.test(subject)) return true
  if (body && FORWARD_BODY_RE.test(body)) return true
  return false
}

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr',
  'outlook.com', 'outlook.pt', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.uk',
  'yahoo.es', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'gmx.com', 'gmx.de',
  'protonmail.com', 'proton.me', 'sapo.pt', 'clix.pt', 'iol.pt', 'netcabo.pt',
  'mail.com', 'zoho.com', 'pm.me',
])

const TLD_STRIP_RE = /\.(com|net|org|io|co|pt|eu|uk|us|br|de|fr|es|it|nl|be|ch|at|au|nz|ca|app|dev|ai|tech|digital|agency|studio|group|cloud)\b.*/i

function titleCase(s: string): string {
  return s.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function domainToCompanyName(domain: string): string {
  const base = domain.replace(TLD_STRIP_RE, '').replace(/\.[a-z]{2,4}$/, '')
  return base.split(/[-_.]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function deriveCompanyFromSender(email: string, displayName: string): { name: string; domain: string | null } | null {
  const parts = email.toLowerCase().split('@')
  if (parts.length !== 2) return null
  const local = parts[0].replace(/\+.*$/, '')
  const domain = parts[1]

  if (!PERSONAL_DOMAINS.has(domain)) {
    return { name: domainToCompanyName(domain), domain }
  }

  const dn = displayName?.trim() ?? ''
  if (dn && /\s/.test(dn) && !dn.includes('@')) {
    const words = dn.split(/\s+/).filter(Boolean)
    if (words.length >= 2) return { name: titleCase(dn), domain: null }
  }

  const tokens = local.split(/[._\-]/).filter(Boolean)
  if (tokens.length >= 2) {
    return { name: tokens.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(' '), domain: null }
  }

  return null
}

type AddressInfo = { address?: string; name?: string }

function flattenAddresses(raw: ParsedMail['from'] | ParsedMail['to'] | ParsedMail['cc']): AddressInfo[] {
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  const out: AddressInfo[] = []
  for (const entry of list) {
    if (!entry?.value) continue
    for (const a of entry.value) {
      if (a.address) out.push({ address: a.address, name: a.name })
    }
  }
  return out
}

export type SyncResult = {
  ok: true
  synced: number
  created_leads: number
  skipped_duplicate: number
  skipped_unknown_outbound: number
  legacy_fixed: number
  hasMore: boolean
  message: string
} | {
  ok: false
  error: string
}

export type SyncOptions = {
  /**
   * Maximum number of candidate UIDs (across both mailboxes combined) to
   * fully process in this call. Used by the Inngest function to keep each
   * invocation under Vercel's 60s function limit; if more candidates remain
   * after the cap, the function dispatches a continuation event.
   *
   * The route handler (Vercel cron) uses a high default so it stays a
   * single call when the inbox is small enough.
   */
  maxEmails?: number
}

/**
 * Cheap envelope-only count of how many candidate emails a full sync would
 * need to process. Called once at the start of an Inngest chain so the UI
 * progress bar has a denominator. ~5-10s for inboxes with thousands of
 * historical messages — connects to IMAP, lists envelopes since the same
 * cut-off as runImapSync(), dedupes against DB.
 */
export async function countPendingCandidates(): Promise<{
  total: number
  syncSince: string
  error?: string
}> {
  const supabase = createServiceClient()

  const { data: latestEmail } = await supabase
    .from('interactions')
    .select('occurred_at')
    .eq('type', 'email')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .single()

  const syncSince = latestEmail?.occurred_at
    ? new Date(new Date(latestEmail.occurred_at).getTime() - 24 * 60 * 60 * 1000)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  const dedupSince = new Date(syncSince.getTime() - 2 * 24 * 60 * 60 * 1000)
  const { data: existingRows } = await supabase
    .from('interactions')
    .select('source_id')
    .not('source_id', 'is', null)
    .gte('occurred_at', dedupSince.toISOString())

  const existingSourceIds = new Set<string>()
  for (const row of existingRows ?? []) {
    if (row.source_id) existingSourceIds.add(row.source_id)
  }

  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    tls: { rejectUnauthorized: false },
    logger: false,
  })

  try {
    await client.connect()

    let sentPath = 'Sent'
    try {
      const allBoxes = await client.list()
      const sentBox = allBoxes.find((b) =>
        (b as unknown as Record<string, unknown>).specialUse === '\\Sent' ||
        /^(sent|sent messages|sent items|itens enviados|\[gmail\]\/sent mail|gesendet|éléments envoyés)$/i.test(b.name)
      )
      if (sentBox) sentPath = sentBox.path
    } catch { /* keep default */ }

    let total = 0
    for (const path of ['INBOX', sentPath]) {
      let lock
      try { lock = await client.getMailboxLock(path) } catch { continue }
      try {
        const searchResult = await client.search({ since: syncSince }, { uid: true })
        const allUids = searchResult === false ? [] : searchResult
        if (allUids.length === 0) continue

        for await (const msg of client.fetch([...allUids].reverse().slice(0, 2000), {
          uid: true, envelope: true,
        }, { uid: true })) {
          const messageId = msg.envelope?.messageId
          if (!messageId) continue
          if (existingSourceIds.has(messageId)) continue
          total++
        }
      } finally {
        lock.release()
      }
    }

    await client.logout()
    return { total, syncSince: syncSince.toISOString() }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { total: 0, syncSince: syncSince.toISOString(), error: msg }
  }
}

export async function runImapSync(options: SyncOptions = {}): Promise<SyncResult> {
  const maxEmails = options.maxEmails ?? 1000
  const supabase = createServiceClient()

  const imapUser  = process.env.IMAP_USER?.toLowerCase() ?? ''
  const ownDomain = imapUser.split('@')[1] ?? ''

  function isInternal(email: string): boolean {
    const e = email.toLowerCase().trim()
    return e === imapUser || (ownDomain.length > 0 && e.endsWith('@' + ownDomain))
  }

  const { data: allIdentifiers } = await supabase
    .from('customer_identifiers')
    .select('value, customer_id')
    .eq('type', 'email')

  const emailToCustomerId = new Map<string, string>()
  for (const id of allIdentifiers ?? []) {
    emailToCustomerId.set(id.value.toLowerCase().trim(), id.customer_id)
  }

  const { data: allCompanies } = await supabase
    .from('companies')
    .select('id, name, domain')

  const companyByDomain = new Map<string, { id: string; name: string }>()
  const companyByName   = new Map<string, { id: string; name: string }>()
  for (const c of allCompanies ?? []) {
    if (c.domain) companyByDomain.set(c.domain.toLowerCase(), { id: c.id, name: c.name })
    companyByName.set(c.name.toLowerCase(), { id: c.id, name: c.name })
  }

  async function ensureCompany(email: string, displayName: string): Promise<{ id: string; name: string } | null> {
    const derived = deriveCompanyFromSender(email, displayName)
    if (!derived) return null

    if (derived.domain && companyByDomain.has(derived.domain)) {
      return companyByDomain.get(derived.domain)!
    }
    const byName = companyByName.get(derived.name.toLowerCase())
    if (byName) return byName

    const { data: created, error } = await supabase
      .from('companies')
      .insert({ name: derived.name, domain: derived.domain, updated_at: new Date().toISOString() })
      .select('id, name, domain')
      .single()
    if (error || !created) return null

    const entry = { id: created.id, name: created.name }
    if (created.domain) companyByDomain.set(created.domain.toLowerCase(), entry)
    companyByName.set(created.name.toLowerCase(), entry)
    return entry
  }

  // Catch-all customer for team-forwarded emails we can't tie to a real external
  // party (e.g. a forwarded automated "New Form Submission"). Without this they'd
  // be dropped as "unknown" and never reach the inbox. Find-or-create, memoized
  // for the run. Has no email identifier, so inbound resolution never matches it.
  const INTERNAL_BUCKET_NAME = 'Interno · Reencaminhados'
  let internalBucketId: string | null = null
  let internalBucketResolved = false
  async function ensureInternalBucket(): Promise<string | null> {
    if (internalBucketResolved) return internalBucketId
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('name', INTERNAL_BUCKET_NAME)
      .maybeSingle()
    if (existing) {
      internalBucketId = existing.id
    } else {
      const { data: createdBucket } = await supabase
        .from('customers')
        .insert({ name: INTERNAL_BUCKET_NAME, status: 'onboarding', health_score: 3 })
        .select('id')
        .single()
      internalBucketId = createdBucket?.id ?? null
    }
    internalBucketResolved = true
    return internalBucketId
  }

  // Name-based attendee → customer match for Calendly recap emails (recaps carry
  // display names, not emails). Lazily loaded once, only if a recap shows up.
  let customerNameList: { id: string; name: string }[] | null = null
  async function matchCustomerByAttendeeNames(names: string[]): Promise<string | null> {
    const externals = names.filter((n) => n && !isHostAttendee(n))
    if (externals.length === 0) return null
    if (!customerNameList) {
      const { data } = await supabase.from('customers').select('id, name')
      customerNameList = (data ?? []) as { id: string; name: string }[]
    }
    const matched = new Set<string>()
    for (const attendee of externals) {
      for (const c of customerNameList) {
        if (c.name && nameMatches(attendee, c.name)) matched.add(c.id)
      }
    }
    // Only link on a single unambiguous match — otherwise it goes to the
    // "unlinked meetings" widget for Pedro to assign manually.
    return matched.size === 1 ? [...matched][0] : null
  }

  const { data: liveFhRows } = await supabase
    .from('fh_integrations')
    .select('customer_id')
    .in('status', ['live', 'integration_done', 'api_received'])
  const liveFhCustomerIds = new Set<string>()
  for (const r of liveFhRows ?? []) {
    if (r.customer_id) liveFhCustomerIds.add(r.customer_id)
  }
  const TROUBLE_RE = /\b(erro|problema|falha|bug|não\s+funciona|nao\s+funciona|ajuda|urgente|error|issue|broken|doesn'?t\s+work|fails|help|support|urgent)\b/i

  const { data: latestEmail } = await supabase
    .from('interactions')
    .select('occurred_at')
    .eq('type', 'email')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .single()

  const syncSince = latestEmail?.occurred_at
    ? new Date(new Date(latestEmail.occurred_at).getTime() - 24 * 60 * 60 * 1000)
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  const dedupSince = new Date(syncSince.getTime() - 2 * 24 * 60 * 60 * 1000)
  const { data: existingRows } = await supabase
    .from('interactions')
    .select('source_id')
    .not('source_id', 'is', null)
    .gte('occurred_at', dedupSince.toISOString())

  const existingSourceIds = new Set<string>()
  for (const row of existingRows ?? []) {
    if (row.source_id) existingSourceIds.add(row.source_id)
  }

  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    tls: { rejectUnauthorized: false },
    logger: false,
  })

  let synced  = 0
  let skipped = 0
  let unknown = 0
  let created = 0
  const legacyFixed = 0
  let hasMore = false

  // Legacy encoding auto-fix removed (2026-06-11). It was a one-time April
  // migration, but the `ilike('content', '%=C3=%')` filter can't use an index,
  // so every sync seq-scanned and detoasted the entire interactions table.
  // Combined with the 3-minute auto-sync it exhausted the Supabase free-tier
  // disk IO budget and took the whole DB down. All legacy rows were fixed
  // months ago; new mail is parsed correctly at ingest (mailparser-1).
  // `legacy_fixed` stays in the response shape as 0 for API compatibility.

  type NewInteraction = {
    customer_id: string
    type: 'email'
    direction: 'inbound' | 'outbound'
    subject: string | null
    content: string | null
    source_id: string
    metadata: Record<string, unknown>
    is_read: boolean
    occurred_at: string
  }
  const buffer: NewInteraction[] = []

  async function flushBuffer() {
    if (buffer.length === 0) return
    const chunk = buffer.splice(0, buffer.length)
    let { error } = await supabase
      .from('interactions')
      .upsert(chunk, { onConflict: 'source_id', ignoreDuplicates: true })
    if (error && /is_read/i.test(error.message ?? '')) {
      const stripped = chunk.map((c) => {
        const { is_read: _is, ...rest } = c
        void _is
        return rest
      })
      const retry = await supabase
        .from('interactions')
        .upsert(stripped, { onConflict: 'source_id', ignoreDuplicates: true })
      error = retry.error
    }
    if (!error) synced += chunk.length
    else console.error('[imap/sync] insert error:', error.message)
  }

  try {
    await client.connect()

    let sentPath = 'Sent'
    try {
      const allBoxes = await client.list()
      const sentBox = allBoxes.find((b) =>
        (b as unknown as Record<string, unknown>).specialUse === '\\Sent' ||
        /^(sent|sent messages|sent items|itens enviados|\[gmail\]\/sent mail|gesendet|éléments envoyés)$/i.test(b.name)
      )
      if (sentBox) sentPath = sentBox.path
    } catch { /* list failed — keep default */ }

    const mailboxes: { path: string; direction: 'inbound' | 'outbound' }[] = [
      { path: 'INBOX',   direction: 'inbound' },
      { path: sentPath,  direction: 'outbound' },
    ]

    // Combined budget across mailboxes — once we've processed maxEmails new
    // bodies (across both INBOX and Sent), we stop and flag hasMore so the
    // caller can dispatch a continuation event.
    let processedThisRun = 0

    mailboxLoop:
    for (const { path, direction } of mailboxes) {
      let lock
      try {
        lock = await client.getMailboxLock(path)
      } catch {
        continue
      }

      try {
        const searchResult = await client.search({ since: syncSince }, { uid: true })
        const allUids = searchResult === false ? [] : searchResult
        if (allUids.length === 0) continue

        const candidateUids: number[] = []
        const uidToMessageId = new Map<number, string>()
        for await (const msg of client.fetch([...allUids].reverse().slice(0, 2000), {
          uid: true, envelope: true,
        }, { uid: true })) {
          const messageId = msg.envelope?.messageId
          if (!messageId) continue
          if (existingSourceIds.has(messageId)) { skipped++; continue }
          existingSourceIds.add(messageId)
          uidToMessageId.set(msg.uid, messageId)
          candidateUids.push(msg.uid)
        }

        if (candidateUids.length === 0) continue

        // Chunking: cap how many candidates we fetch bodies for this run.
        const remaining = Math.max(0, maxEmails - processedThisRun)
        if (remaining === 0) {
          if (candidateUids.length > 0) hasMore = true
          break
        }
        const chunkUids = candidateUids.slice(0, remaining)
        if (chunkUids.length < candidateUids.length) hasMore = true

        type AttachWork = {
          sourceId: string
          matchedEmail: string
          atts: Array<{ name: string; mime: string; size: number; content: Buffer }>
        }
        const attachWork: AttachWork[] = []

        for await (const msg of client.fetch(chunkUids, {
          uid: true, source: true, internalDate: true,
        }, { uid: true })) {
          processedThisRun++
          const messageId = uidToMessageId.get(msg.uid)
          if (!messageId || !msg.source) continue

          let parsed: ParsedMail
          try {
            parsed = await simpleParser(msg.source as Buffer)
          } catch (err) {
            console.error('Parse error for uid', msg.uid, err)
            continue
          }

          const fromList = flattenAddresses(parsed.from)
          const toList   = flattenAddresses(parsed.to)
          const ccList   = flattenAddresses(parsed.cc)
          const replyTo  = flattenAddresses(parsed.replyTo)

          const allFromAreTeam = fromList.length > 0 &&
            fromList.every((a) => !a.address || isInternal(a.address.toLowerCase().trim()))

          const effectiveDirection: 'inbound' | 'outbound' = direction

          const addresses =
            (direction === 'inbound' && allFromAreTeam)
              ? [...toList, ...ccList]
              : direction === 'inbound'
                ? [...fromList, ...ccList]
                : [...toList, ...ccList]

          let customerId: string | null = null
          let matchedEmail = ''
          let primarySenderEmail = ''
          let primarySenderName  = ''

          for (const addr of addresses) {
            if (!addr.address) continue
            const email = addr.address.toLowerCase().trim()
            if (isInternal(email)) continue

            if (!primarySenderEmail) {
              primarySenderEmail = email
              primarySenderName  = addr.name?.trim() || email.split('@')[0]
            }

            const found = emailToCustomerId.get(email)
            if (found) {
              customerId   = found
              matchedEmail = email
              break
            }
          }

          const bodyText = (parsed.text ?? '').trim().slice(0, 4000)
          const bodyHtml = typeof parsed.html === 'string' ? parsed.html.slice(0, 100000) : null

          // ── Calendly Notetaker recap → store as a meeting, not an email ─────
          // Sent by notifications@calendly.com (an automated sender that the
          // normal flow would otherwise drop). Parse it, match the attendee by
          // name, and create a `type='meeting'` interaction — or park it in
          // unlinked_meetings for manual assignment. Then skip email handling.
          const fromAddr0 = (fromList[0]?.address ?? '').toLowerCase().trim()
          if (effectiveDirection === 'inbound' && isCalendlyRecapEmail(fromAddr0, parsed.subject, bodyText)) {
            const recap = parseCalendlyRecap(parsed.text ?? bodyText, bodyHtml)
            const recapTitle = recap.title || parsed.subject || 'Reunião Calendly'
            const recapFallbackDate = (msg.internalDate instanceof Date ? msg.internalDate : new Date()).toISOString()
            const recapOccurredAt = recap.occurredAt ?? recapFallbackDate

            const parts: string[] = []
            if (recap.summary)    parts.push(`Resumo:\n${recap.summary}`)
            if (recap.discussion) parts.push(`Discussão:\n${recap.discussion}`)
            const recapContent = parts.join('\n\n') || bodyText || '(sem conteúdo)'

            const matchedCustomer = await matchCustomerByAttendeeNames(recap.attendeeNames)

            if (matchedCustomer) {
              // source_id = messageId → idempotent (envelope dedup skips re-fetch).
              await supabase.from('interactions').insert({
                customer_id: matchedCustomer,
                type:        'meeting',
                direction:   null,
                subject:     recapTitle,
                content:     recapContent,
                source_id:   messageId,
                bubbles_url:   recap.recapUrl,
                bubbles_title: recapTitle,
                metadata:    { source: 'calendly_notetaker' },
                occurred_at: recapOccurredAt,
              })
            } else {
              // unlinked_meetings has no source_id, so dedup before parking to
              // avoid re-inserting the same recap on every sync.
              let already = false
              if (recap.recapUrl) {
                const { data } = await supabase.from('unlinked_meetings')
                  .select('id').eq('bubbles_url', recap.recapUrl).limit(1).maybeSingle()
                already = !!data
              } else {
                const { data } = await supabase.from('unlinked_meetings')
                  .select('id').eq('title', recapTitle).eq('recorded_at', recapOccurredAt).limit(1).maybeSingle()
                already = !!data
              }
              if (!already) {
                await supabase.from('unlinked_meetings').insert({
                  title:       recapTitle,
                  summary:     recap.summary || null,
                  transcript:  recap.discussion || null,
                  bubbles_url: recap.recapUrl,
                  attendees:   recap.attendeeNames,
                  recorded_at: recapOccurredAt,
                })
              }
            }
            continue
          }

          if (!primarySenderEmail && effectiveDirection === 'inbound' && allFromAreTeam && bodyText) {
            const fwd = extractForwardedSender(bodyText)
            if (fwd && !isInternal(fwd.email)) {
              primarySenderEmail = fwd.email
              primarySenderName  = fwd.name || fwd.email.split('@')[0]
              const found = emailToCustomerId.get(fwd.email)
              if (found) { customerId = found; matchedEmail = fwd.email }
            }
          }

          if (!primarySenderEmail && bodyText && allFromAreTeam) {
            // A team member forwarded an automated submission (FH form or Kapta
            // confirmation). The quoted "From:" is itself internal
            // (site@/notificacoes@kapta.pt), so the only real counterparty is the
            // partner email inside the template body. Detect by BODY, not sender,
            // so forwards from ANY @kapta.pt mailbox (e.g. bruno@) are captured —
            // otherwise these get dropped as "unknown" and never reach the inbox.
            // Safe here: we're already gated on allFromAreTeam, so partner replies
            // that merely quote the template (sender = partner) can't reach this.
            if (isFhIntegrationBody(bodyText)) {
              const fhP = parseFhIntegrationEmail(bodyText)
              if (fhP.email && !isInternal(fhP.email)) {
                primarySenderEmail = fhP.email
                primarySenderName  = fhP.name || fhP.email.split('@')[0]
                const found = emailToCustomerId.get(fhP.email)
                if (found) { customerId = found; matchedEmail = fhP.email }
              }
            } else if (isFhConfirmationBody(bodyText)) {
              const recipient = toList.find((a) => a.address && !isInternal(a.address.toLowerCase().trim()))?.address?.toLowerCase().trim() ?? null
              const confP = parseFhConfirmationEmail(bodyText, recipient)
              if (confP.email && !isInternal(confP.email)) {
                primarySenderEmail = confP.email
                primarySenderName  = confP.name || confP.email.split('@')[0]
                const found = emailToCustomerId.get(confP.email)
                if (found) { customerId = found; matchedEmail = confP.email }
              }
            }
          }

          // Kept even when we can't pin an external party: a team member
          // forwarded it on purpose, so it must not silently vanish.
          const isTeamForward =
            effectiveDirection === 'inbound' && allFromAreTeam &&
            isForwardedEmail(parsed.subject ?? null, bodyText)

          // Automated original sender (noreply/notifications/…): skip — UNLESS a
          // team member forwarded it, in which case fall through to the internal
          // catch-all bucket below so it still reaches the inbox.
          if (!customerId && effectiveDirection === 'inbound' && primarySenderEmail
              && isAutomatedSender(primarySenderEmail) && !isTeamForward) {
            unknown++; continue
          }

          if (
            !customerId &&
            effectiveDirection === 'inbound' &&
            isSpamSender(primarySenderName || fromList[0]?.name, primarySenderEmail)
          ) {
            unknown++; continue
          }

          // Real external sender (incl. a forwarded real person) → create the lead
          // and attach. Automated senders never reach here on a normal inbound
          // (skipped above); on a team forward we deliberately skip lead creation
          // so noreply@ doesn't become a customer — it falls to the bucket instead.
          if (!customerId && effectiveDirection === 'inbound' && primarySenderEmail
              && !isAutomatedSender(primarySenderEmail)) {
            const senderName = primarySenderName || primarySenderEmail.split('@')[0]

            const company = await ensureCompany(primarySenderEmail, primarySenderName)

            const { data: newCustomer, error: insertErr } = await supabase
              .from('customers')
              .insert({
                name: senderName,
                status: 'onboarding',
                health_score: 3,
                company:    company?.name ?? null,
                company_id: company?.id   ?? null,
              })
              .select('id')
              .single()

            if (!insertErr && newCustomer) {
              await supabase.from('customer_identifiers').insert({
                customer_id: newCustomer.id,
                type:        'email',
                value:       primarySenderEmail,
                is_primary:  true,
              })
              emailToCustomerId.set(primarySenderEmail, newCustomer.id)
              customerId   = newCustomer.id
              matchedEmail = primarySenderEmail
              created++
            }
          }

          if (!customerId && effectiveDirection === 'outbound') {
            for (const addr of replyTo) {
              if (!addr.address) continue
              const email = addr.address.toLowerCase().trim()
              if (isInternal(email)) continue
              if (!primarySenderEmail) {
                primarySenderEmail = email
                primarySenderName  = addr.name?.trim() || email.split('@')[0]
              }
              const found = emailToCustomerId.get(email)
              if (found) { customerId = found; matchedEmail = email; break }
            }

            if (!customerId && bodyText) {
              const fwd = extractForwardedSender(bodyText)
              if (fwd && !isInternal(fwd.email)) {
                if (!primarySenderEmail) {
                  primarySenderEmail = fwd.email
                  primarySenderName  = fwd.name || fwd.email.split('@')[0]
                }
                const found = emailToCustomerId.get(fwd.email)
                if (found) { customerId = found; matchedEmail = fwd.email }
              }
            }
          }

          // Team-forwarded but still unresolved (e.g. a forwarded automated form
          // notification): park under the internal catch-all so it stays visible
          // on the email page instead of being dropped as "unknown".
          let attachedToBucket = false
          if (!customerId && isTeamForward) {
            const bucket = await ensureInternalBucket()
            if (bucket) {
              customerId = bucket
              matchedEmail = primarySenderEmail || ''
              attachedToBucket = true
            }
          }

          if (!customerId) { unknown++; continue }

          const subject = parsed.subject ?? null
          const rawDate = msg.internalDate ?? parsed.date ?? new Date()
          const date    = rawDate instanceof Date ? rawDate : new Date(rawDate)

          const fromForFh = fromList[0]?.address ?? primarySenderEmail
          // Direct from site@kapta.pt OR forwarded by a team member (body match).
          const isFh = isFhIntegrationEmail(fromForFh, subject, bodyText)
                    || (allFromAreTeam && isFhIntegrationBody(bodyText))
          const fhParsed = isFh ? parseFhIntegrationEmail(bodyText) : null

          const isFhConfirm = isFhConfirmationEmail(fromForFh, bodyText)
                           || (allFromAreTeam && isFhConfirmationBody(bodyText))
          let fhConfirmBumpedId: string | null = null
          if (isFhConfirm && primarySenderEmail) {
            const { data: existingFh } = await supabase
              .from('fh_integrations')
              .select('id, status, integration_completed_at')
              .eq('email', primarySenderEmail)
              .maybeSingle()
            if (existingFh) {
              fhConfirmBumpedId = existingFh.id
              const nextStatus = existingFh.status === 'live' ? 'live' : 'integration_done'
              await supabase
                .from('fh_integrations')
                .update({
                  status: nextStatus,
                  integration_completed_at: existingFh.integration_completed_at ?? date.toISOString(),
                })
                .eq('id', existingFh.id)
            }
          }
          const fhConfirmParsed = isFhConfirm
            ? parseFhConfirmationEmail(bodyText, primarySenderEmail)
            : null
          const shouldFlagConfirmAsPending = isFhConfirm && !fhConfirmBumpedId

          let troubleshootHint = false
          let troubleshootMatch: string | null = null
          if (
            effectiveDirection === 'inbound' &&
            customerId &&
            liveFhCustomerIds.has(customerId)
          ) {
            const haystack = `${subject ?? ''}\n${bodyText ?? ''}`
            const m = haystack.match(TROUBLE_RE)
            if (m) {
              troubleshootHint = true
              troubleshootMatch = m[0]
            }
          }

          if (isFh && fhParsed?.name && customerId) {
            const parsedName = fhParsed.name.trim()
            const looksHuman = /\s/.test(parsedName) || /[A-Z]/.test(parsedName)
            const localPart  = (matchedEmail || '').split('@')[0].toLowerCase()
            if (looksHuman && localPart) {
              const { data: cur } = await supabase
                .from('customers')
                .select('name')
                .eq('id', customerId)
                .maybeSingle()
              if (cur?.name && cur.name.toLowerCase() === localPart) {
                await supabase.from('customers').update({ name: parsedName }).eq('id', customerId)
              }
            }
          }

          const detectedPlatforms = detectPlatforms(subject, bodyText, fromForFh)

          buffer.push({
            customer_id: customerId,
            type:        'email',
            direction:   effectiveDirection,
            subject,
            content:     bodyText || null,
            source_id:   messageId,
            metadata:    {
              matched_email: matchedEmail,
              parsed_version: 'mailparser-1',
              ...(bodyHtml ? { html: bodyHtml } : {}),
              ...(isFh ? { fh_integration_request: true, fh_parsed: fhParsed } : {}),
              ...(shouldFlagConfirmAsPending ? {
                fh_integration_request: true,
                fh_confirmation: true,
                fh_parsed: { email: primarySenderEmail, name: fhConfirmParsed?.name ?? null },
              } : {}),
              ...(fhConfirmBumpedId ? { fh_confirmation_bumped: fhConfirmBumpedId } : {}),
              ...(troubleshootHint ? { fh_troubleshoot_hint: true, fh_troubleshoot_match: troubleshootMatch } : {}),
              ...(detectedPlatforms.length > 0 ? { detected_platforms: detectedPlatforms } : {}),
              ...(attachedToBucket ? { internal_forward: true } : {}),
            },
            is_read:     effectiveDirection === 'outbound',
            occurred_at: date.toISOString(),
          })

          const attList = parsed.attachments ?? []
          if (attList.length > 0) {
            attachWork.push({
              sourceId: messageId,
              matchedEmail,
              atts: attList
                .filter((a) => a.content && (a.filename || a.cid))
                .map((a) => ({
                  name: a.filename || `file-${a.cid ?? 'attachment'}`,
                  mime: a.contentType ?? 'application/octet-stream',
                  size: a.size ?? (a.content as Buffer).length,
                  content: a.content as Buffer,
                })),
            })
          }

          if (buffer.length >= 50) await flushBuffer()

          if (processedThisRun >= maxEmails) {
            // Stopped mid-mailbox — there are more candidates left in this
            // box plus potentially the other mailbox. Caller will continue.
            hasMore = true
            await flushBuffer()
            break
          }
        }

        await flushBuffer()

        if (attachWork.length > 0) {
          await supabase.storage.createBucket(ATTACH_BUCKET, { public: true }).catch(() => null)

          for (const work of attachWork) {
            const attachments: AttachmentMeta[] = []

            for (const att of work.atts) {
              if (att.size > ATTACH_MAX_BYTES) {
                attachments.push({
                  name: att.name, mime: att.mime, size: att.size, url: null,
                  ai_summary: `${att.name} (${(att.size / 1024 / 1024).toFixed(1)} MB — too large to download)`,
                })
                continue
              }
              try {
                const ext = att.name.includes('.') ? att.name.split('.').pop() : 'bin'
                const fileName = `${work.sourceId.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}/${randomUUID()}.${ext}`

                const { error: upErr } = await supabase.storage
                  .from(ATTACH_BUCKET)
                  .upload(fileName, att.content, { contentType: att.mime, upsert: false })
                if (upErr) continue

                const { data: { publicUrl } } = supabase.storage.from(ATTACH_BUCKET).getPublicUrl(fileName)

                const ai_summary = att.size <= ATTACH_MAX_ANALYZE
                  ? await analyzeAttachment(att.content, { mime: att.mime, name: att.name, size: att.size })
                  : att.name

                attachments.push({ name: att.name, mime: att.mime, size: att.size, url: publicUrl, ai_summary })
              } catch (err) {
                console.error('Attachment upload error:', att.name, err)
              }
            }

            if (attachments.length > 0) {
              const { data: existing } = await supabase
                .from('interactions')
                .select('metadata')
                .eq('source_id', work.sourceId)
                .maybeSingle()
              const prev = (existing?.metadata as Record<string, unknown> | null) ?? {}
              await supabase
                .from('interactions')
                .update({ metadata: { ...prev, matched_email: work.matchedEmail, attachments, parsed_version: 'mailparser-1' } })
                .eq('source_id', work.sourceId)
            }
          }
        }
      } finally {
        lock.release()
      }

      if (hasMore) break mailboxLoop
    }

    await client.logout()

    return {
      ok: true,
      synced,
      created_leads: created,
      skipped_duplicate: skipped,
      skipped_unknown_outbound: unknown,
      legacy_fixed: legacyFixed,
      hasMore,
      message: `${synced} imported, ${created} new leads, ${skipped} duplicates, ${unknown} unknown outbound, ${legacyFixed} legacy decoded${hasMore ? ' — more remaining' : ''}`,
    }
  } catch (error) {
    const host = process.env.IMAP_HOST ?? '(not set)'
    const port = process.env.IMAP_PORT ?? '993'
    const err  = error as unknown as Record<string, unknown>
    const msg  = error instanceof Error ? error.message : String(error)
    const fullError = `[${host}:${port}] ${msg} | response=${JSON.stringify(err.response ?? null)} | code=${err.code ?? null}`
    console.error('IMAP sync error:', fullError)
    return { ok: false, error: fullError }
  }
}
