import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT = `You are an assistant helping a Portuguese business manager named Pedro triage his email inbox inside a CRM called Kapta.

For each email provided, return a JSON object with:
- customer_id: string (the id provided)
- priority: "urgent" | "high" | "medium" | "low"
- category: "suporte" | "comercial" | "financeiro" | "feedback" | "reunião" | "informação" | "outro"
- summary: string (one sentence in Portuguese, max 15 words — what the person wants)
- action: string (what Pedro should do, in Portuguese, max 12 words)

Rules:
- urgent: client angry, deadline today, service down, contract at risk
- high: client waiting >3 days, specific question that blocks them, payment issue
- medium: general question, follow-up, scheduling
- low: FYI, newsletter, acknowledgement

Return ONLY a valid JSON array, no markdown, no explanation.`

type TriageResult = {
  customer_id: string
  priority: 'urgent' | 'high' | 'medium' | 'low'
  category: string
  summary: string
  action: string
}

export async function POST() {
  const supabase = createServiceClient()

  // Load the last 500 email interactions ordered newest first
  const { data: allEmails } = await supabase
    .from('interactions')
    .select('id, customer_id, direction, subject, content, occurred_at, customers(id, name, company)')
    .eq('type', 'email')
    .order('occurred_at', { ascending: false })
    .limit(500)

  if (!allEmails || allEmails.length === 0) {
    return NextResponse.json({ ok: true, results: [], message: 'Sem emails para analisar.' })
  }

  // Deduplicate by customer: keep only the most recent per customer
  const byCustomer = new Map<string, typeof allEmails[0]>()
  for (const e of allEmails) {
    if (!byCustomer.has(e.customer_id)) byCustomer.set(e.customer_id, e)
  }

  // Keep only inbound (customer emailed us, no outbound reply since)
  const needsReply: typeof allEmails = []
  for (const [, email] of byCustomer) {
    if (email.direction === 'inbound') needsReply.push(email)
  }

  if (needsReply.length === 0) {
    return NextResponse.json({ ok: true, results: [], message: 'Nenhum email por responder.' })
  }

  // Build email batch for Claude (max 30 to keep within token limits)
  const batch = needsReply.slice(0, 30)

  const emailsText = batch.map((e) => {
    const customer = Array.isArray(e.customers) ? e.customers[0] : e.customers
    const name = customer ? `${customer.name}${customer.company ? ` (${customer.company})` : ''}` : 'Desconhecido'
    const body = e.content ? e.content.slice(0, 600) : '(sem corpo)'
    return JSON.stringify({
      customer_id: e.customer_id,
      from: name,
      subject: e.subject ?? '(sem assunto)',
      date: e.occurred_at,
      body,
    })
  }).join('\n')

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Analyze these emails and return a JSON array:\n\n${emailsText}`,
      },
    ],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'

  let results: TriageResult[] = []
  try {
    results = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, error: 'Claude returned invalid JSON', raw }, { status: 500 })
  }

  // Persist triage results into interaction metadata
  for (const r of results) {
    const email = batch.find((e) => e.customer_id === r.customer_id)
    if (!email) continue
    await supabase
      .from('interactions')
      .update({ metadata: { ai_triage: r } })
      .eq('id', email.id)
  }

  return NextResponse.json({ ok: true, results, total: needsReply.length })
}
