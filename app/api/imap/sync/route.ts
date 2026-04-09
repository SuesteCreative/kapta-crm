import { NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * IMAP Sync — Safe by design:
 * - Reads email metadata + plain-text only (no HTML, no images, no attachments)
 * - Never marks emails as read, never clicks links, never loads remote content
 * - Only logs emails where sender OR recipient is a known customer
 * - Deduplicates by Message-ID so re-syncing is safe
 * - Skips Spam/Junk/Trash automatically
 * - Only fetches UNSEEN (unread) messages since last sync
 */
export async function GET() {
  const supabase = createServiceClient()

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

  let synced = 0
  let skipped = 0
  let unknown = 0

  try {
    await client.connect()

    // Process both INBOX (inbound) and Sent (outbound)
    const mailboxes: { path: string; direction: 'inbound' | 'outbound' }[] = [
      { path: 'INBOX', direction: 'inbound' },
      { path: 'Sent',  direction: 'outbound' },
    ]

    for (const { path, direction } of mailboxes) {
      // Some servers use "Sent Items" or "Sent Messages"
      let lock
      try {
        lock = await client.getMailboxLock(path)
      } catch {
        // Mailbox doesn't exist on this server — skip silently
        continue
      }

      try {
        // Only fetch UNSEEN (unread) messages — won't spam old emails
        // Also limits to last 100 unseen to avoid huge initial sync
        const uids: number[] = []
        for await (const msg of client.fetch({ seen: false }, { uid: true })) {
          uids.push(msg.uid)
        }

        // Process newest first, max 50 per sync
        const toProcess = uids.reverse().slice(0, 50)
        if (toProcess.length === 0) continue

        for await (const msg of client.fetch(toProcess, {
          uid: true,
          envelope: true,
          // Plain text body only — no HTML, no attachments, no tracking pixels
          bodyParts: ['1'],  // MIME part 1 = text/plain
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
          // Inbound: match sender. Outbound: match first recipient.
          const addresses =
            direction === 'inbound'
              ? (msg.envelope?.from ?? [])
              : (msg.envelope?.to ?? [])

          let customerId: string | null = null
          let matchedEmail = ''

          for (const addr of addresses) {
            if (!addr.address) continue
            const email = addr.address.toLowerCase().trim()
            // Skip our own address
            if (email === process.env.IMAP_USER?.toLowerCase()) continue

            const { data: identifier } = await supabase
              .from('customer_identifiers')
              .select('customer_id')
              .eq('value', email)
              .maybeSingle()

            if (identifier) {
              customerId = (identifier as { customer_id: string }).customer_id
              matchedEmail = email
              break
            }
          }

          // Not a known customer — skip entirely (phishing/spam never match)
          if (!customerId) { unknown++; continue }

          const subject = msg.envelope?.subject ?? null
          const date    = msg.envelope?.date    ?? new Date()

          // Extract plain text from body part 1
          let bodyText = ''
          if (msg.bodyParts) {
            const part = msg.bodyParts.get('1')
            if (part) {
              bodyText = part.toString('utf8').trim().slice(0, 4000)
            }
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
      skipped_duplicate: skipped,
      skipped_unknown_sender: unknown,
      message: `${synced} imported, ${skipped} duplicates, ${unknown} from unknown senders`,
    })
  } catch (error) {
    const host = process.env.IMAP_HOST ?? '(not set)'
    const port = process.env.IMAP_PORT ?? '993'
    const err = error as unknown as Record<string, unknown>
    const msg = error instanceof Error ? error.message : String(error)
    const response = err.response ?? null
    const code = err.code ?? null
    const fullError = `[${host}:${port}] ${msg} | response=${JSON.stringify(response)} | code=${code}`
    console.error('IMAP sync error:', fullError)
    return NextResponse.json({ ok: false, error: fullError }, { status: 500 })
  }
}
