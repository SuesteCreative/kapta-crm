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

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST() {
  const supabase = createServiceClient()

  // Step 1: Fast query — no content, just enough to find who needs a reply
  const { data: allEmails } = await supabase
    .from('interactions')
    .select('id, customer_id, direction, subject, occurred_at, customers(id, name, company)')
    .eq('type', 'email')
    .order('occurred_at', { ascending: false })
    .limit(500)

  if (!allEmails || allEmails.length === 0) {
    return NextResponse.json({ ok: true, results: [], message: 'Sem emails para analisar.' })
  }

  // Deduplicate: most recent per customer
  const byCustomer = new Map<string, typeof allEmails[0]>()
  for (const e of allEmails) {
    if (!byCustomer.has(e.customer_id)) byCustomer.set(e.customer_id, e)
  }

  // Keep only inbound-last
  const needsReply: typeof allEmails = []
  for (const [, email] of byCustomer) {
    if (email.direction === 'inbound') needsReply.push(email)
  }

  if (needsReply.length === 0) {
    return NextResponse.json({ ok: true, results: [], message: 'Nenhum email por responder.' })
  }

  // Step 2: Fetch content only for the batch (max 15)
  const batchIds = needsReply.slice(0, 15).map((e) => e.id)
  const { data: batchWithContent } = await supabase
    .from('interactions')
    .select('id, customer_id, direction, subject, content, occurred_at, customers(id, name, company)')
    .in('id', batchIds)

  const batch = batchWithContent ?? needsReply.slice(0, 15)

  // Step 3: Build compact prompt — truncate body to 300 chars
  const emailsText = batch.map((e) => {
    const customer = Array.isArray(e.customers) ? e.customers[0] : e.customers
    const name = customer ? `${customer.name}${customer.company ? ` (${customer.company})` : ''}` : 'Desconhecido'
    const rawBody = ('content' in e && e.content) ? (e.content as string) : ''
    const body = rawBody ? stripHtml(rawBody).slice(0, 400) : '(sem corpo)'
    return JSON.stringify({
      customer_id: e.customer_id,
      from: name,
      subject: e.subject ?? '(sem assunto)',
      body,
    })
  }).join('\n')

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Analyze these emails and return a JSON array:\n\n${emailsText}` }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = rawText.match(/\[[\s\S]*\]/)
  const raw = match ? match[0] : '[]'

  let results: TriageResult[] = []
  try {
    results = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, error: 'Claude returned invalid JSON', raw }, { status: 500 })
  }

  // Step 4: Parallel DB writes — merge with existing metadata (preserve is_spam etc.)
  await Promise.all(
    results.map(async (r) => {
      const email = batch.find((e) => e.customer_id === r.customer_id)
      if (!email) return
      const { data: existing } = await supabase
        .from('interactions')
        .select('metadata')
        .eq('id', email.id)
        .single()
      const merged = { ...(existing?.metadata as Record<string, unknown> ?? {}), ai_triage: r }
      await supabase.from('interactions').update({ metadata: merged }).eq('id', email.id)
    })
  )

  return NextResponse.json({ ok: true, results, total: needsReply.length })
}
