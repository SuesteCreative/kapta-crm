import { NextRequest, NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { simpleParser, ParsedMail } from 'mailparser'
import { createServiceClient } from '@/lib/supabase'
import { analyzeAttachment } from '@/lib/analyze-attachment'
import { decodeLegacyEmailContent, looksLikeLegacyEmail } from '@/lib/decode-legacy-email'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

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

function extractForwardedSender(body: string): { email: string; name: string } | null {
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

export async function GET(req: NextRequest) {
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

  const { data: allIdentifiers } = await supabase
    .from('customer_identifiers')
    .select('value, customer_id')
    .eq('type', 'email')

  const emailToCustomerId = new Map<string, string>()
  for (const id of allIdentifiers ?? []) {
    emailToCustomerId.set(id.value.toLowerCase().trim(), id.customer_id)
  }

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
  let legacyFixed = 0

  // Auto-fix legacy rows: emails stored before the mailparser switch still
  // carry raw MIME boundaries and quoted-printable =XX runs. Decoder is a
  // pure string transform, idempotent — rows already clean are skipped.
  try {
    const { data: legacyRows } = await supabase
      .from('interactions')
      .select('id, content')
      .eq('type', 'email')
      .not('content', 'is', null)
      .ilike('content', '%=C3=%')
      .limit(500)

    const updates: Array<{ id: string; content: string }> = []
    for (const r of legacyRows ?? []) {
      if (!r.content || !looksLikeLegacyEmail(r.content)) continue
      const decoded = decodeLegacyEmailContent(r.content)
      if (decoded && decoded !== r.content) updates.push({ id: r.id, content: decoded })
    }
    for (let i = 0; i < updates.length; i += 20) {
      const chunk = updates.slice(i, i + 20)
      await Promise.all(
        chunk.map((u) =>
          supabase.from('interactions').update({ content: u.content }).eq('id', u.id)
        )
      )
      legacyFixed += chunk.length
    }
  } catch (err) {
    console.error('Legacy auto-fix failed (non-blocking):', err)
  }

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
    const { error } = await supabase
      .from('interactions')
      .upsert(chunk, { onConflict: 'source_id', ignoreDuplicates: true })
    if (!error) synced += chunk.length
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

        // Pass 1: envelope-only fetch to dedup without pulling bodies
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

        // Attachment work collected during parse
        type AttachWork = {
          sourceId: string
          matchedEmail: string
          atts: Array<{ name: string; mime: string; size: number; content: Buffer }>
        }
        const attachWork: AttachWork[] = []

        // Pass 2: fetch full source for new messages only, parse with mailparser
        for await (const msg of client.fetch(candidateUids, {
          uid: true, source: true, internalDate: true,
        }, { uid: true })) {
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

          // Team-forward inbound: FROM=@kapta.pt, TO=@kapta.pt — no external address in envelope.
          // Parse forwarded body to recover the original sender (e.g. Bruno fwd Petstourism to Pedro).
          if (!primarySenderEmail && effectiveDirection === 'inbound' && allFromAreTeam && bodyText) {
            const fwd = extractForwardedSender(bodyText)
            if (fwd && !isInternal(fwd.email)) {
              primarySenderEmail = fwd.email
              primarySenderName  = fwd.name || fwd.email.split('@')[0]
              const found = emailToCustomerId.get(fwd.email)
              if (found) { customerId = found; matchedEmail = fwd.email }
            }
          }

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

          if (!customerId) { unknown++; continue }

          const subject = parsed.subject ?? null
          const rawDate = msg.internalDate ?? parsed.date ?? new Date()
          const date    = rawDate instanceof Date ? rawDate : new Date(rawDate)

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
            },
            occurred_at: date.toISOString(),
          })

          // Collect attachments (already decoded by mailparser)
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
              // Preserve html set during buffer push; read back and merge
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
    }

    await client.logout()

    return NextResponse.json({
      ok: true,
      synced,
      created_leads: created,
      skipped_duplicate: skipped,
      skipped_unknown_outbound: unknown,
      legacy_fixed: legacyFixed,
      message: `${synced} imported, ${created} new leads, ${skipped} duplicates, ${unknown} unknown outbound, ${legacyFixed} legacy decoded`,
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
