import { NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Targeted IMAP sync for specific customers.
 * POST { customer_ids: string[] }
 *
 * Searches INBOX for emails FROM known addresses (inbound)
 * and Sent for emails TO known addresses (outbound).
 * Safe: read-only, deduplicates by Message-ID, never marks as read.
 */
export async function POST(req: Request) {
  const body = await req.json() as { customer_ids: string[] }
  const { customer_ids } = body

  if (!customer_ids || customer_ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'customer_ids required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Build lookup: email → customer_id (lowercase)
  const emailToCustomer = new Map<string, string>()

  // Source 1: registered email identifiers
  const { data: identifiers } = await supabase
    .from('customer_identifiers')
    .select('customer_id, value')
    .in('customer_id', customer_ids)
    .eq('type', 'email')

  for (const id of identifiers ?? []) {
    emailToCustomer.set(id.value.toLowerCase().trim(), id.customer_id)
  }

  // Source 2: emails seen in past interactions (matched_email in metadata)
  // Covers customers whose address was never formally registered as an identifier
  const { data: pastInteractions } = await supabase
    .from('interactions')
    .select('customer_id, metadata')
    .in('customer_id', customer_ids)
    .eq('type', 'email')
    .not('metadata', 'is', null)

  for (const i of pastInteractions ?? []) {
    const meta = i.metadata as Record<string, unknown> | null
    const matched = meta?.matched_email
    if (typeof matched === 'string' && matched) {
      emailToCustomer.set(matched.toLowerCase().trim(), i.customer_id)
    }
  }

  if (emailToCustomer.size === 0) {
    return NextResponse.json({ ok: true, synced: 0, skipped: 0, message: 'Nenhum email associado a este cliente.' })
  }
  const emails = [...emailToCustomer.keys()]

  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    tls: { rejectUnauthorized: false },
    logger: false,
  })

  let synced = 0
  let skipped = 0

  try {
    await client.connect()

    // Discover Sent folder using SPECIAL-USE flag (most reliable across servers)
    let sentPath = 'Sent'
    try {
      const allBoxes = await client.list()
      const sentBox = allBoxes.find((b) =>
        (b as unknown as Record<string, unknown>).specialUse === '\\Sent' ||
        /^(sent|sent messages|sent items|\[gmail\]\/sent mail|gesendet|éléments envoyés)$/i.test(b.name)
      )
      if (sentBox) sentPath = sentBox.path
    } catch { /* list failed — keep default */ }

    const mailboxes: { path: string; direction: 'inbound' | 'outbound'; searchField: 'from' | 'to' }[] = [
      { path: 'INBOX',   direction: 'inbound',  searchField: 'from' },
      { path: sentPath,  direction: 'outbound', searchField: 'to'   },
    ]

    for (const { path, direction, searchField } of mailboxes) {
      let lock
      try {
        lock = await client.getMailboxLock(path)
      } catch {
        continue // Mailbox doesn't exist on this server
      }

      try {
        // Collect matching UIDs across all email addresses
        const uidSet = new Set<number>()
        for (const email of emails) {
          try {
            const uids = await client.search({ [searchField]: email }, { uid: true })
            if (uids) for (const uid of uids) uidSet.add(uid)
          } catch {
            // search failed for this address — skip
          }
        }

        if (uidSet.size === 0) continue

        // Fetch newest first, max 200 per mailbox per sync
        const toProcess = [...uidSet].reverse().slice(0, 200)

        for await (const msg of client.fetch(toProcess, {
          uid: true,
          envelope: true,
          internalDate: true,
          bodyParts: ['1'], // text/plain only
        }, { uid: true })) {

          // Use Message-ID for dedup; fall back to date+subject if missing
          const rawDate   = msg.internalDate ?? msg.envelope?.date ?? new Date()
          const emailDate = rawDate instanceof Date ? rawDate : new Date(rawDate)
          const messageId = msg.envelope?.messageId
            ?? `fallback:${emailDate.toISOString()}:${msg.envelope?.subject ?? ''}`
          if (!messageId || messageId === 'fallback::') continue

          // Dedup
          const { data: existing } = await supabase
            .from('interactions')
            .select('id')
            .eq('source_id', messageId)
            .maybeSingle()
          if (existing) { skipped++; continue }

          // Resolve customer from matched addresses
          const candidates = direction === 'inbound'
            ? (msg.envelope?.from ?? [])
            : (msg.envelope?.to ?? [])

          let customerId: string | null = null
          let matchedEmail = ''

          for (const addr of candidates) {
            if (!addr.address) continue
            const email = addr.address.toLowerCase().trim()
            if (email === process.env.IMAP_USER?.toLowerCase()) continue
            const cid = emailToCustomer.get(email)
            if (cid) { customerId = cid; matchedEmail = email; break }
          }

          // Fallback: for outbound, also check CC/from
          if (!customerId && direction === 'outbound') {
            for (const addr of (msg.envelope?.from ?? [])) {
              if (!addr.address) continue
              const email = addr.address.toLowerCase().trim()
              const cid = emailToCustomer.get(email)
              if (cid) { customerId = cid; matchedEmail = email; break }
            }
          }

          if (!customerId) continue

          let bodyText = ''
          if (msg.bodyParts) {
            const part = msg.bodyParts.get('1')
            if (part) bodyText = part.toString('utf8').trim().slice(0, 4000)
          }

          const { error } = await supabase.from('interactions').insert({
            customer_id: customerId,
            type:        'email',
            direction,
            subject:     msg.envelope?.subject ?? null,
            content:     bodyText || null,
            source_id:   messageId,
            metadata:    { matched_email: matchedEmail, sync_source: 'manual' },
            occurred_at: emailDate.toISOString(),
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
      skipped,
      message: synced > 0
        ? `${synced} email(s) importado(s).`
        : 'Nenhum email novo encontrado.',
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('IMAP sync-customer error:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
