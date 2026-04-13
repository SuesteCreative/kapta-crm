import { NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * IMAP Sync — Safe by design:
 * - Reads email metadata + plain-text only (no HTML, no images, no attachments)
 * - Never marks emails as read, never clicks links, never loads remote content
 * - Matches known customers OR auto-creates leads for new inbound senders
 * - Deduplicates by Message-ID so re-syncing is safe
 * - Skips Spam/Junk/Trash automatically
 * - Treats the entire sending domain (e.g. @kapta.pt) as internal
 */
export async function GET() {
  const supabase = createServiceClient()

  // The domain of the IMAP account — all addresses at this domain are
  // treated as internal and skipped when matching customers.
  // e.g. if IMAP_USER=pedro@kapta.pt, then site@kapta.pt, bruno@kapta.pt, etc.
  // are all treated as internal senders and not matched against customer_identifiers.
  const imapUser   = process.env.IMAP_USER?.toLowerCase() ?? ''
  const ownDomain  = imapUser.split('@')[1] ?? ''

  function isInternal(email: string): boolean {
    const e = email.toLowerCase().trim()
    return e === imapUser || (ownDomain.length > 0 && e.endsWith('@' + ownDomain))
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

  let synced    = 0
  let skipped   = 0
  let unknown   = 0
  let created   = 0

  try {
    await client.connect()

    // Process both INBOX (inbound) and Sent (outbound)
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

        // Process newest first, max 2000 per sync run
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

          // ── Deduplication ──
          const { data: existing } = await supabase
            .from('interactions')
            .select('id')
            .eq('source_id', messageId)
            .maybeSingle()
          if (existing) { skipped++; continue }

          // ── Resolve customer ──
          // Inbound: match sender + CC. Outbound: match recipients + CC.
          // Internal addresses (same domain) are skipped.
          const addresses =
            direction === 'inbound'
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

            // Track the first external address as the primary sender (for auto-create)
            if (!primarySenderEmail) {
              primarySenderEmail = email
              primarySenderName  = addr.name?.trim() || email.split('@')[0]
            }

            const { data: identifier } = await supabase
              .from('customer_identifiers')
              .select('customer_id')
              .eq('value', email)
              .maybeSingle()

            if (identifier) {
              customerId   = (identifier as { customer_id: string }).customer_id
              matchedEmail = email
              break
            }
          }

          // ── Auto-create lead for unknown inbound senders ──
          // Outbound to unknown = noise (newsletters, auto-replies, etc.) — skip.
          if (!customerId && direction === 'inbound' && primarySenderEmail) {
            const senderName = primarySenderName || primarySenderEmail.split('@')[0]

            const { data: newCustomer, error: insertErr } = await supabase
              .from('customers')
              .insert({
                name:         senderName,
                status:       'onboarding',
                health_score: 3,
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

          const { error } = await supabase.from('interactions').insert({
            customer_id: customerId,
            type:        'email',
            direction,
            subject,
            content:     bodyText || null,
            source_id:   messageId,
            metadata:    { matched_email: matchedEmail },
            occurred_at: date.toISOString(),
          })

          if (!error) synced++
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
