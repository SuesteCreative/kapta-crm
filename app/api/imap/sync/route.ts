import { NextRequest, NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { createServiceClient } from '@/lib/supabase'
import { analyzeAttachment } from '@/lib/analyze-attachment'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const ATTACH_BUCKET = 'email-attachments'
const ATTACH_MAX_BYTES   = 15 * 1024 * 1024 // skip download > 15 MB
const ATTACH_MAX_ANALYZE =  5 * 1024 * 1024 // skip AI analysis > 5 MB

type AttachmentMeta = { name: string; mime: string; size: number; url: string | null; ai_summary: string }

/** Walk IMAP bodyStructure tree and return parts with disposition=attachment */
function findAttachmentParts(
  node: Record<string, unknown> | null | undefined,
  path = '',
): Array<{ part: string; name: string; mime: string; size: number }> {
  if (!node) return []
  const type = ((node.type as string) ?? '').toLowerCase()
  if (type === 'multipart') {
    const children = (node.childNodes as Record<string, unknown>[]) ?? []
    return children.flatMap((child, i) =>
      findAttachmentParts(child, path ? `${path}.${i + 1}` : `${i + 1}`)
    )
  }
  const disposition = (((node.disposition as Record<string, unknown>)?.value as string) ?? '').toLowerCase()
  if (disposition !== 'attachment') return []
  const dispParams  = ((node.disposition as Record<string, unknown>)?.params ?? {}) as Record<string, string>
  const nodeParams  = ((node.parameters as Record<string, string>) ?? {})
  const name = dispParams.filename || nodeParams.name || `file-${path || '1'}`
  const mime = `${type}/${((node.subtype as string) ?? 'octet-stream').toLowerCase()}`
  const size = (node.size as number) ?? 0
  return [{ part: path || '1', name, mime, size }]
}

/**
 * IMAP Sync — Safe by design:
 * - Reads email metadata + plain-text only (no HTML, no images, no attachments)
 * - Never marks emails as read, never clicks links, never loads remote content
 * - Matches known customers OR auto-creates leads for new inbound senders
 * - Deduplicates by Message-ID — pre-loaded into a Set (no N+1 queries)
 * - Batch-inserts new interactions (no N+1 on inserts)
 * - Skips Spam/Junk/Trash automatically
 * - Treats the entire sending domain (e.g. @kapta.pt) as internal
 */
// Automated sender prefixes — never create a lead for these
const AUTOMATED_PREFIXES = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'notifications', 'notification', 'mailer-daemon', 'postmaster',
  'bounce', 'bounces', 'unsubscribe', 'newsletter', 'marketing',
  'automatico', 'automacao', 'robot', 'autoresponder', 'auto-reply',
  'autoreply', 'info-noreply', 'support-noreply', 'updates', 'alerts',
]

function isAutomatedSender(email: string): boolean {
  const local = email.split('@')[0].toLowerCase().replace(/\+.*$/, '') // strip +tag
  return AUTOMATED_PREFIXES.some((p) => local === p || local.startsWith(p + '-') || local.startsWith(p + '_'))
}

/** Extract original sender email from a forwarded email body.
 *  Handles Gmail, Outlook, Apple Mail (incl. "> From:" quoted lines). */
function extractForwardedSender(body: string): { email: string; name: string } | null {
  // Match "From:" at line start, optionally preceded by ">" quote chars and spaces
  const patterns = [
    /^[>\s]*From:\s+(?:"?([^"<\r\n]+?)"?\s+)?<([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/im,
    /^[>\s]*From:\s+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/im,
  ]
  for (const pattern of patterns) {
    const match = body.match(pattern)
    if (match) {
      const name  = match[1]?.trim() ?? ''
      const email = (match[2] ?? match[1])?.toLowerCase().trim()
      if (email?.includes('@')) return { email, name }
    }
  }
  return null
}

export async function GET(req: NextRequest) {
  // Auth: Vercel cron header, session cookie (browser button), or CRON_SECRET bearer (external cron)
  const isVercelCron   = req.headers.get('x-vercel-cron') === '1'
  const sessionCookie  = req.cookies.get('kapta_session')?.value
  const validSession   = process.env.AUTH_SESSION_TOKEN
  const cronSecret     = process.env.CRON_SECRET
  const authHeader     = req.headers.get('authorization')

  const allowed =
    isVercelCron ||
    (validSession && sessionCookie === validSession) ||
    (cronSecret   && authHeader   === `Bearer ${cronSecret}`)

  if (!allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const imapUser  = process.env.IMAP_USER?.toLowerCase() ?? ''
  const ownDomain = imapUser.split('@')[1] ?? ''

  function isInternal(email: string): boolean {
    const e = email.toLowerCase().trim()
    return e === imapUser || (ownDomain.length > 0 && e.endsWith('@' + ownDomain))
  }

  // ── Pre-load ALL email identifiers once ──
  const { data: allIdentifiers } = await supabase
    .from('customer_identifiers')
    .select('value, customer_id')
    .eq('type', 'email')

  const emailToCustomerId = new Map<string, string>()
  for (const id of allIdentifiers ?? []) {
    emailToCustomerId.set(id.value.toLowerCase().trim(), id.customer_id)
  }

  // ── Determine sync window: since latest known email minus 1 day (safety buffer) ──
  // First sync → last 90 days. Subsequent syncs → only recent emails. Much faster.
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

  // ── Pre-load source_ids only within the sync window (+ 2-day buffer) ──
  // No need to load all 1000+ historical IDs — dedup only needed for recent window
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
    auth: {
      user: process.env.IMAP_USER!,
      pass: process.env.IMAP_PASSWORD!,
    },
    tls: { rejectUnauthorized: false },
    logger: false,
  })

  let synced  = 0
  let skipped = 0
  let unknown = 0
  let created = 0

  // Batch buffer — flushed every 50 rows
  type NewInteraction = {
    customer_id: string
    type: 'email'
    direction: 'inbound' | 'outbound'
    subject: string | null
    content: string | null
    source_id: string
    metadata: Record<string, unknown>
    occurred_at: string
  }
  const buffer: NewInteraction[] = []

  async function flushBuffer() {
    if (buffer.length === 0) return
    const chunk = buffer.splice(0, buffer.length)
    // upsert with ignoreDuplicates = ON CONFLICT (source_id) DO NOTHING
    // requires unique constraint on source_id — safe to call even before constraint exists
    const { error } = await supabase
      .from('interactions')
      .upsert(chunk, { onConflict: 'source_id', ignoreDuplicates: true })
    if (!error) synced += chunk.length
  }

  try {
    await client.connect()

    // Discover Sent folder using SPECIAL-USE flag (most reliable across servers)
    // Fallback: try common folder names
    let sentPath = 'Sent'
    try {
      const allBoxes = await client.list()
      const sentBox = allBoxes.find((b) =>
        (b as unknown as Record<string, unknown>).specialUse === '\\Sent' ||
        /^(sent|sent messages|sent items|\[gmail\]\/sent mail|gesendet|éléments envoyés)$/i.test(b.name)
      )
      if (sentBox) sentPath = sentBox.path
    } catch { /* list failed — keep default */ }

    const mailboxes: { path: string; direction: 'inbound' | 'outbound' }[] = [
      { path: 'INBOX',   direction: 'inbound' },
      { path: sentPath,  direction: 'outbound' },
    ]

    for (const { path, direction } of mailboxes) {
      let lock
      try {
        lock = await client.getMailboxLock(path)
      } catch {
        continue
      }

      try {
        const searchResult = await client.search({ since: syncSince }, { uid: true })
        const uids = searchResult === false ? [] : searchResult

        const toProcess = [...uids].reverse().slice(0, 2000)
        if (toProcess.length === 0) continue

        // Attachment work collected during fetch — processed after flushBuffer()
        type AttachWork = {
          uid: number
          sourceId: string
          matchedEmail: string
          parts: Array<{ part: string; name: string; mime: string; size: number }>
        }
        const attachWork: AttachWork[] = []

        for await (const msg of client.fetch(toProcess, {
          uid: true,
          envelope: true,
          internalDate: true,
          bodyStructure: true,
          bodyParts: ['1'],
        }, { uid: true })) {

          const messageId = msg.envelope?.messageId
          if (!messageId) continue

          // ── Deduplication — O(1) Set lookup, no DB query ──
          if (existingSourceIds.has(messageId)) { skipped++; continue }
          existingSourceIds.add(messageId) // prevent dupes within this run

          // ── Resolve direction + customer ──
          // If inbox email is FROM a team member (@kapta.pt), keep direction=inbound
          // (Pedro received it) but look at TO for the customer —
          // e.g. site@kapta.pt notifying Pedro about a new lead, Bruno forwarding, etc.
          const fromAddrs = msg.envelope?.from ?? []
          const allFromAreTeam = fromAddrs.length > 0 &&
            fromAddrs.every(a => !a.address || isInternal(a.address.toLowerCase().trim()))

          // Stored direction: always honour the mailbox (INBOX=inbound, Sent=outbound)
          const effectiveDirection: 'inbound' | 'outbound' = direction

          // Customer address lookup: when FROM is all-team, the external party is in TO
          const addresses =
            (direction === 'inbound' && allFromAreTeam)
              ? [...(msg.envelope?.to ?? []), ...(msg.envelope?.cc ?? [])]
              : direction === 'inbound'
                ? [...(msg.envelope?.from ?? []), ...(msg.envelope?.cc ?? [])]
                : [...(msg.envelope?.to ?? []), ...(msg.envelope?.cc ?? [])]

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

          // ── Auto-create lead for unknown inbound senders ──
          // Skip automated senders (noreply, mailer-daemon, newsletters, etc.)
          if (!customerId && effectiveDirection === 'inbound' && primarySenderEmail && isAutomatedSender(primarySenderEmail)) {
            unknown++; continue
          }

          if (!customerId && effectiveDirection === 'inbound' && primarySenderEmail) {
            const senderName = primarySenderName || primarySenderEmail.split('@')[0]

            const { data: newCustomer, error: insertErr } = await supabase
              .from('customers')
              .insert({ name: senderName, status: 'onboarding', health_score: 3 })
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

          // Read body early — needed for forward parsing fallback
          let bodyText = ''
          if (msg.bodyParts) {
            const part = msg.bodyParts.get('1')
            if (part) bodyText = part.toString('utf8').trim().slice(0, 4000)
          }

          // ── Fallback for team forwards (FROM=@kapta.pt, TO=@kapta.pt) ──
          // Try Reply-To first, then parse forwarded body (Gmail/Outlook/Apple Mail)
          if (!customerId && effectiveDirection === 'outbound') {
            // 1. Reply-To header
            const replyTo = msg.envelope?.replyTo ?? []
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

            // 2. Parse forwarded body: "From: Name <email>" pattern
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

            // Sent-folder outbound to unknown address → skip.
            // Pedro knows who he emailed; if not in CRM, he'll add manually.
          }

          if (!customerId) { unknown++; continue }

          const subject = msg.envelope?.subject ?? null
          const rawDate = msg.internalDate ?? msg.envelope?.date ?? new Date()
          const date    = rawDate instanceof Date ? rawDate : new Date(rawDate)

          buffer.push({
            customer_id: customerId,
            type:        'email',
            direction:   effectiveDirection,
            subject,
            content:     bodyText || null,
            source_id:   messageId,
            metadata:    { matched_email: matchedEmail },
            occurred_at: date.toISOString(),
          })

          // Queue attachment work (processed after flush — cannot fetchOne mid-fetch)
          const attParts = findAttachmentParts(msg.bodyStructure as unknown as Record<string, unknown> | null)
          if (attParts.length > 0) {
            attachWork.push({ uid: msg.uid, sourceId: messageId, matchedEmail, parts: attParts })
          }

          // Flush every 50
          if (buffer.length >= 50) await flushBuffer()
        }

        await flushBuffer()

        // ── Attachment download + analysis (runs after all interactions are inserted) ──
        if (attachWork.length > 0) {
          await supabase.storage.createBucket(ATTACH_BUCKET, { public: true }).catch(() => null)

          for (const work of attachWork) {
            const attachments: AttachmentMeta[] = []

            for (const att of work.parts) {
              if (att.size > ATTACH_MAX_BYTES) {
                attachments.push({
                  name: att.name, mime: att.mime, size: att.size, url: null,
                  ai_summary: `${att.name} (${(att.size / 1024 / 1024).toFixed(1)} MB — too large to download)`,
                })
                continue
              }
              try {
                const attMsg = await client.fetchOne(work.uid.toString(), { bodyParts: [att.part] }, { uid: true })
                if (!attMsg) continue
                const attBuf = (attMsg as Exclude<typeof attMsg, false>).bodyParts?.get(att.part)
                if (!attBuf) continue

                const nodeBuffer = Buffer.from(attBuf)
                const ext = att.name.includes('.') ? att.name.split('.').pop() : 'bin'
                const fileName = `${work.sourceId.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}/${randomUUID()}.${ext}`

                const { error: upErr } = await supabase.storage
                  .from(ATTACH_BUCKET)
                  .upload(fileName, nodeBuffer, { contentType: att.mime, upsert: false })
                if (upErr) continue

                const { data: { publicUrl } } = supabase.storage.from(ATTACH_BUCKET).getPublicUrl(fileName)

                const ai_summary = att.size <= ATTACH_MAX_ANALYZE
                  ? await analyzeAttachment(nodeBuffer, { mime: att.mime, name: att.name, size: att.size })
                  : att.name

                attachments.push({ name: att.name, mime: att.mime, size: att.size, url: publicUrl, ai_summary })
              } catch (err) {
                console.error('Attachment fetch/upload error:', att.name, err)
              }
            }

            if (attachments.length > 0) {
              await supabase
                .from('interactions')
                .update({ metadata: { matched_email: work.matchedEmail, attachments } })
                .eq('source_id', work.sourceId)
            }
          }
        }
      } finally {
        lock.release()
      }
    }

    await client.logout()

    return NextResponse.json({
      ok: true,
      synced,
      created_leads: created,
      skipped_duplicate: skipped,
      skipped_unknown_outbound: unknown,
      message: `${synced} imported, ${created} new leads, ${skipped} duplicates, ${unknown} unknown outbound`,
    })
  } catch (error) {
    const host = process.env.IMAP_HOST ?? '(not set)'
    const port = process.env.IMAP_PORT ?? '993'
    const err  = error as unknown as Record<string, unknown>
    const msg  = error instanceof Error ? error.message : String(error)
    const fullError = `[${host}:${port}] ${msg} | response=${JSON.stringify(err.response ?? null)} | code=${err.code ?? null}`
    console.error('IMAP sync error:', fullError)
    return NextResponse.json({ ok: false, error: fullError }, { status: 500 })
  }
}
