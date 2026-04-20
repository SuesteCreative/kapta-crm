import { NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { simpleParser, ParsedMail } from 'mailparser'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

export async function POST(req: Request) {
  const body = await req.json() as { customer_ids: string[] }
  const { customer_ids } = body

  if (!customer_ids || customer_ids.length === 0) {
    return NextResponse.json({ ok: false, error: 'customer_ids required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const emailToCustomer = new Map<string, string>()

  const { data: identifiers } = await supabase
    .from('customer_identifiers')
    .select('customer_id, value')
    .in('customer_id', customer_ids)
    .eq('type', 'email')

  for (const id of identifiers ?? []) {
    emailToCustomer.set(id.value.toLowerCase().trim(), id.customer_id)
  }

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

    let sentPath = 'Sent'
    try {
      const allBoxes = await client.list()
      const sentBox = allBoxes.find((b) =>
        (b as unknown as Record<string, unknown>).specialUse === '\\Sent' ||
        /^(sent|sent messages|sent items|itens enviados|\[gmail\]\/sent mail|gesendet|éléments envoyés)$/i.test(b.name)
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
        continue
      }

      try {
        const uidSet = new Set<number>()
        for (const email of emails) {
          try {
            const uids = await client.search({ [searchField]: email }, { uid: true })
            if (uids) for (const uid of uids) uidSet.add(uid)
          } catch { /* skip */ }
        }

        if (uidSet.size === 0) continue

        const allUids = [...uidSet].reverse().slice(0, 200)

        // Pass 1: envelope-only to dedup before pulling sources
        const candidateUids: number[] = []
        const uidToMessageId = new Map<number, string>()
        for await (const msg of client.fetch(allUids, {
          uid: true, envelope: true, internalDate: true,
        }, { uid: true })) {
          const rawDate   = msg.internalDate ?? msg.envelope?.date ?? new Date()
          const emailDate = rawDate instanceof Date ? rawDate : new Date(rawDate)
          const messageId = msg.envelope?.messageId
            ?? `fallback:${emailDate.toISOString()}:${msg.envelope?.subject ?? ''}`
          if (!messageId || messageId === 'fallback::') continue

          const { data: existing } = await supabase
            .from('interactions')
            .select('id')
            .eq('source_id', messageId)
            .maybeSingle()
          if (existing) { skipped++; continue }

          uidToMessageId.set(msg.uid, messageId)
          candidateUids.push(msg.uid)
        }

        if (candidateUids.length === 0) continue

        // Pass 2: fetch source + parse
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

          const candidates = direction === 'inbound' ? fromList : toList

          let customerId: string | null = null
          let matchedEmail = ''

          for (const addr of candidates) {
            if (!addr.address) continue
            const email = addr.address.toLowerCase().trim()
            if (email === process.env.IMAP_USER?.toLowerCase()) continue
            const cid = emailToCustomer.get(email)
            if (cid) { customerId = cid; matchedEmail = email; break }
          }

          if (!customerId && direction === 'outbound') {
            for (const addr of fromList) {
              if (!addr.address) continue
              const email = addr.address.toLowerCase().trim()
              const cid = emailToCustomer.get(email)
              if (cid) { customerId = cid; matchedEmail = email; break }
            }
          }

          if (!customerId) continue

          const bodyText = (parsed.text ?? '').trim().slice(0, 4000)
          const rawDate = msg.internalDate ?? parsed.date ?? new Date()
          const emailDate = rawDate instanceof Date ? rawDate : new Date(rawDate)

          const { error } = await supabase.from('interactions').insert({
            customer_id: customerId,
            type:        'email',
            direction,
            subject:     parsed.subject ?? null,
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
