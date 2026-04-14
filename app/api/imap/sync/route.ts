import { NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

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
export async function GET() {
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

  // ── Pre-load ALL existing source_ids — eliminates N+1 dedup queries ──
  const { data: existingRows } = await supabase
    .from('interactions')
    .select('source_id')
    .not('source_id', 'is', null)

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
    const { error } = await supabase.from('interactions').insert(chunk)
    if (!error) synced += chunk.length
  }

  try {
    await client.connect()

    const mailboxes: { path: string; direction: 'inbound' | 'outbound' }[] = [
      { path: 'INBOX', direction: 'inbound' },
      { path: 'Sent',  direction: 'outbound' },
    ]

    for (const { path, direction } of mailboxes) {
      let lock
      try {
        lock = await client.getMailboxLock(path)
      } catch {
        continue
      }

      try {
        const uids: number[] = []
        for await (const msg of client.fetch('1:*', { uid: true })) {
          uids.push(msg.uid)
        }

        const toProcess = uids.reverse().slice(0, 2000)
        if (toProcess.length === 0) continue

        for await (const msg of client.fetch(toProcess, {
          uid: true,
          envelope: true,
          internalDate: true,
          bodyParts: ['1'],
        }, { uid: true })) {

          const messageId = msg.envelope?.messageId
          if (!messageId) continue

          // ── Deduplication — O(1) Set lookup, no DB query ──
          if (existingSourceIds.has(messageId)) { skipped++; continue }
          existingSourceIds.add(messageId) // prevent dupes within this run

          // ── Resolve direction + customer ──
          // If inbox email is FROM a team member (@kapta.pt), treat as outbound
          // and look at TO for the customer — e.g. Bruno forwarding or CC'ing Pedro
          const fromAddrs = msg.envelope?.from ?? []
          const allFromAreTeam = fromAddrs.length > 0 &&
            fromAddrs.every(a => !a.address || isInternal(a.address.toLowerCase().trim()))

          const effectiveDirection: 'inbound' | 'outbound' =
            direction === 'inbound' && allFromAreTeam ? 'outbound' : direction

          const addresses =
            effectiveDirection === 'inbound'
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

          if (!customerId) { unknown++; continue }

          const subject = msg.envelope?.subject ?? null
          const rawDate = msg.internalDate ?? msg.envelope?.date ?? new Date()
          const date    = rawDate instanceof Date ? rawDate : new Date(rawDate)

          let bodyText = ''
          if (msg.bodyParts) {
            const part = msg.bodyParts.get('1')
            if (part) bodyText = part.toString('utf8').trim().slice(0, 4000)
          }

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

          // Flush every 50
          if (buffer.length >= 50) await flushBuffer()
        }

        await flushBuffer()
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
