import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT = `You are a CRM assistant for Pedro (Kapta, Portuguese B2B SaaS).

Analyze each customer's recent emails and suggest the single most important follow-up action Pedro should take. Only suggest if there is a clear actionable next step.

Return JSON array. Each item:
- customer_id: string
- title: string (PT, max 10 words, infinitive verb, e.g. "Enviar proposta de renovação")
- description: string (PT, 1-2 sentences explaining why this follow-up matters)
- priority: "urgent"|"high"|"medium"|"low"

Priority: urgent=at-risk client or overdue commitment; high=sales opportunity or unresolved issue; medium=general check-in; low=routine.
Only include customers who genuinely need action. Empty array if none. JSON array only. No markdown.`

type FollowUpSuggestion = {
  customer_id: string
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
}

type EnrichedSuggestion = FollowUpSuggestion & {
  customer_name: string
  customer_company: string | null
}

export async function POST() {
  const supabase = createServiceClient()

  // Fetch recent inbound emails (last 30 days), 1 per customer
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: emails } = await supabase
    .from('interactions')
    .select('id, customer_id, subject, content, occurred_at, metadata, customers(id, name, company)')
    .eq('type', 'email')
    .eq('direction', 'inbound')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(100)

  if (!emails || emails.length === 0) {
    return NextResponse.json({ ok: true, suggestions: [], message: 'Sem emails recentes.' })
  }

  // Dedup: keep most recent per customer (filter spam in JS to handle NULL metadata correctly)
  const nonSpam = emails.filter((e) => (e.metadata as Record<string, unknown> | null)?.is_spam !== true)
  const byCustomer = new Map<string, typeof emails[number]>()
  for (const e of nonSpam) {
    if (!byCustomer.has(e.customer_id)) byCustomer.set(e.customer_id, e)
  }

  // Exclude customers who already have an open follow-up
  const { data: openFollowUps } = await supabase
    .from('follow_ups')
    .select('customer_id')
    .eq('status', 'open')

  const hasOpenFollowUp = new Set((openFollowUps ?? []).map((f) => f.customer_id))

  const candidates = [...byCustomer.values()]
    .filter((e) => !hasOpenFollowUp.has(e.customer_id))
    .slice(0, 15)

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, suggestions: [], message: 'Todos os clientes já têm follow-ups abertos.' })
  }

  // Build Claude input
  const itemsText = candidates.map((e, i) => {
    const customer = Array.isArray(e.customers) ? e.customers[0] : e.customers
    const label = customer ? `${customer.name}${customer.company ? ` (${customer.company})` : ''}` : 'Desconhecido'
    const atts = ((e.metadata as Record<string, unknown>)?.attachments as Array<{ name: string; ai_summary?: string }> | undefined) ?? []
    const attSuffix = atts.length > 0 ? ` [Attachments: ${atts.map((a) => `${a.name}: ${a.ai_summary ?? a.name}`).join(' | ')}]` : ''
    const body = (e.content ?? '').replace(/\n+/g, ' ').slice(0, 500) + attSuffix
    return `${i + 1}. ${label} [customer_id: ${e.customer_id}]\n   Date: ${e.occurred_at.slice(0, 10)} | Subject: ${e.subject ?? '(sem assunto)'}\n   ${body}`
  }).join('\n\n')

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let message
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Suggest follow-ups for these customers:\n\n${itemsText}` }],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: `Claude error: ${msg}` }, { status: 500 })
  }

  const textBlock = message.content.find((c) => c.type === 'text')
  const rawText = textBlock && textBlock.type === 'text' ? textBlock.text : ''
  const match = rawText.match(/\[[\s\S]*\]/)
  if (!match) {
    return NextResponse.json({ ok: false, error: 'Claude returned unexpected format' }, { status: 500 })
  }

  let claudeResults: FollowUpSuggestion[] = []
  try {
    claudeResults = JSON.parse(match[0])
  } catch {
    return NextResponse.json({ ok: false, error: 'Claude devolveu JSON inválido' }, { status: 500 })
  }

  // Enrich with customer name/company
  const suggestions: EnrichedSuggestion[] = []
  for (const r of claudeResults) {
    const email = candidates.find((e) => e.customer_id === r.customer_id)
    if (!email) continue
    const customer = Array.isArray(email.customers) ? email.customers[0] : email.customers
    suggestions.push({
      ...r,
      customer_name: customer?.name ?? 'Desconhecido',
      customer_company: customer?.company ?? null,
    })
  }

  return NextResponse.json({ ok: true, suggestions })
}
