import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT = `You are a spam classifier for a Portuguese B2B CRM called Kapta. Pedro manages real client relationships.

For each email provided, determine if it is spam/phishing/cold-outreach or a legitimate client email.

Return ONLY a valid JSON array of objects with:
- interaction_id: string (the id provided)
- is_spam: boolean

Classify as spam (is_spam: true):
- Automated notifications from social networks (Instagram, Facebook, LinkedIn, Twitter/X story recaps, follower alerts)
- Phishing attempts, fake alerts, password reset scams from unknown senders
- Mass cold outreach / unsolicited sales pitches from companies Pedro never contacted
- Newsletters Pedro never signed up for
- Automated system emails: noreply@, no-reply@, stories-recap@, notifications@, mailer@, bounce@
- Job offers, recruitment spam
- Prize / lottery / giveaway scams
- Marketing emails from brands (not Pedro's actual clients)

Classify as legitimate (is_spam: false):
- Real clients asking questions or reporting issues
- Partners or vendors Pedro is actively working with
- Follow-ups on real business conversations
- Any email where the sender's domain matches a client's company domain

When in doubt, classify as legitimate (false) — false negatives are less harmful than false positives.

Return ONLY valid JSON array, no markdown, no explanation.`

type IncomingEmail = {
  interaction_id: string
  customer_id: string
  from_name: string
  company: string | null
  subject: string
}

type SpamResult = {
  interaction_id: string
  is_spam: boolean
}

export async function POST(req: Request) {
  const body = await req.json() as { emails: IncomingEmail[] }
  const { emails } = body

  if (!emails || emails.length === 0) {
    return NextResponse.json({ ok: true, spam_ids: [] })
  }

  const supabase = createServiceClient()

  // Look up the primary email address for each customer — this is the key signal for spam detection
  const customerIds = [...new Set(emails.map((e) => e.customer_id))]
  const { data: identifiers } = await supabase
    .from('customer_identifiers')
    .select('customer_id, value')
    .eq('type', 'email')
    .in('customer_id', customerIds)

  // Build a map: customer_id → email address
  const emailByCustomer = new Map<string, string>()
  if (identifiers) {
    for (const id of identifiers) {
      if (!emailByCustomer.has(id.customer_id)) {
        emailByCustomer.set(id.customer_id, id.value)
      }
    }
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const emailsText = emails.map((e) => {
    const senderEmail = emailByCustomer.get(e.customer_id) ?? '(desconhecido)'
    return JSON.stringify({
      interaction_id: e.interaction_id,
      from_name: e.from_name,
      from_email: senderEmail,
      company: e.company ?? null,
      subject: e.subject,
    })
  }).join('\n')

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Classify these emails:\n\n${emailsText}` }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  // Extract JSON array regardless of surrounding text or code fences
  const match = rawText.match(/\[[\s\S]*\]/)
  const raw = match ? match[0] : '[]'

  let results: SpamResult[] = []
  try {
    results = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, error: 'Claude returned invalid JSON', raw }, { status: 500 })
  }

  const spamIds = results.filter((r) => r.is_spam).map((r) => r.interaction_id)

  // Persist is_spam=true to metadata, merging with existing fields
  if (spamIds.length > 0) {
    const { data: existing } = await supabase
      .from('interactions')
      .select('id, metadata')
      .in('id', spamIds)

    if (existing) {
      await Promise.all(
        existing.map((row) => {
          const merged = { ...(row.metadata as Record<string, unknown> ?? {}), is_spam: true }
          return supabase.from('interactions').update({ metadata: merged }).eq('id', row.id)
        })
      )
    }
  }

  return NextResponse.json({ ok: true, spam_ids: spamIds, total: emails.length })
}
