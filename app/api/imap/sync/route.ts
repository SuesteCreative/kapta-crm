import { NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

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
    logger: false,
  })

  let synced = 0
  let skipped = 0

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      // Fetch last 50 unseen messages
      const messages = []
      for await (const msg of client.fetch('1:50', {
        envelope: true,
        source: true,
        uid: true,
      })) {
        messages.push(msg)
      }

      for (const msg of messages) {
        const messageId = msg.envelope?.messageId
        if (!messageId) continue

        // Skip if already imported
        const { data: existing } = await supabase
          .from('interactions')
          .select('id')
          .eq('source_id', messageId)
          .limit(1)
          .single()

        if (existing) { skipped++; continue }

        // Try to resolve customer by sender or recipient email
        const from = msg.envelope?.from?.[0]
        const senderEmail = from?.address ?? ''

        let customerId: string | null = null

        if (senderEmail) {
          const { data: identifier } = await supabase
            .from('customer_identifiers')
            .select('customer_id')
            .eq('value', senderEmail.toLowerCase())
            .limit(1)
            .maybeSingle()
          customerId = (identifier as { customer_id: string } | null)?.customer_id ?? null
        }

        // If no customer found, skip (or could auto-create — future feature)
        if (!customerId) { skipped++; continue }

        const subject = msg.envelope?.subject ?? null
        const date = msg.envelope?.date ?? new Date()

        // Decode body text (simplified — full MIME parsing would use mailparser)
        let bodyText = ''
        if (msg.source) {
          const raw = msg.source.toString('utf8')
          // Extract plain text portion (very basic extraction)
          const textMatch = raw.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?:\r\n--|\r\n\r\n--)/i)
          bodyText = textMatch ? textMatch[1].trim() : raw.slice(0, 2000)
        }

        await supabase.from('interactions').insert({
          customer_id: customerId,
          type: 'email',
          direction: 'inbound',
          subject,
          content: bodyText || null,
          source_id: messageId,
          occurred_at: date.toISOString(),
        })

        synced++
      }
    } finally {
      lock.release()
    }

    await client.logout()

    return NextResponse.json({ ok: true, synced, skipped })
  } catch (error) {
    console.error('IMAP sync error:', error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
