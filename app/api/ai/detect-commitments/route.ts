import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT = `És um assistente que analisa interações de Pedro com clientes de uma empresa portuguesa B2B chamada Kapta.

O teu objetivo é identificar compromissos explícitos ou implícitos que Pedro assumiu com clientes, em qualquer canal: email, WhatsApp, reuniões, chamadas ou notas.

Exemplos de linguagem de compromisso:
- Português: "vou enviar", "vou verificar", "fico de", "vou ligar", "envio amanhã", "tratarei de", "falo com a equipa e", "confirmo até", "ficou acordado que", "ficámos de", "Pedro ficou de"
- Inglês: "I'll send", "I'll check", "I'll call", "I'll follow up", "I'll get back to you", "we agreed that", "I will"

Para cada interação que contenha um compromisso, retorna um objeto JSON com:
- customer_id: string (o id fornecido)
- interaction_type: string (o tipo fornecido: email, whatsapp, meeting, call, note)
- commitment_text: string (frase curta do compromisso em português, max 20 palavras)
- suggested_title: string (título de follow-up em português, max 10 palavras, começa com verbo no infinitivo, ex: "Enviar proposta atualizada ao cliente")
- suggested_priority: "low" | "medium" | "high" | "urgent"

Regras de prioridade:
- urgent: prazo mencionado nos próximos 2 dias, cliente em risco de churn
- high: prazo esta semana, assunto financeiro ou contratual
- medium: compromisso geral sem prazo imediato
- low: follow-up informal, apenas cortesia

Se uma interação não contiver nenhum compromisso claro, não a incluas.
Retorna APENAS um array JSON válido, sem markdown, sem explicações.`

type CommitmentResult = {
  customer_id: string
  interaction_type: string
  commitment_text: string
  suggested_title: string
  suggested_priority: 'low' | 'medium' | 'high' | 'urgent'
}

type CommitmentSuggestion = CommitmentResult & {
  customer_name: string
  customer_company: string | null
}

export async function POST() {
  const supabase = createServiceClient()

  // Fetch last 60 days across all relevant interaction types
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  const { data: interactions } = await supabase
    .from('interactions')
    .select('id, customer_id, type, direction, subject, content, occurred_at, customers(id, name, company)')
    .gte('occurred_at', since)
    .or('type.eq.meeting,type.eq.call,type.eq.note,and(type.eq.email,direction.eq.outbound),and(type.eq.whatsapp,direction.eq.outbound)')
    .order('occurred_at', { ascending: false })
    .limit(300)

  if (!interactions || interactions.length === 0) {
    return NextResponse.json({ ok: true, results: [], scanned: 0, skipped_existing: 0, message: 'Sem interações para analisar.' })
  }

  // Dedup: 1 most-recent per (customer_id + type) to spread token budget across channels
  const seen = new Set<string>()
  const deduped: typeof interactions = []
  for (const i of interactions) {
    const key = `${i.customer_id}:${i.type}`
    if (!seen.has(key) && i.content && i.content.trim().length > 10) {
      seen.add(key)
      deduped.push(i)
    }
  }

  const batch = deduped.slice(0, 50)
  if (batch.length === 0) {
    return NextResponse.json({ ok: true, results: [], scanned: 0, skipped_existing: 0, message: 'Sem conteúdo para analisar.' })
  }

  // Load existing open follow-ups for duplicate detection
  const { data: openFollowUps } = await supabase
    .from('follow_ups')
    .select('customer_id, title')
    .eq('status', 'open')

  const openTitles = new Map<string, string[]>()
  for (const fu of openFollowUps ?? []) {
    const arr = openTitles.get(fu.customer_id) ?? []
    arr.push(fu.title.toLowerCase())
    openTitles.set(fu.customer_id, arr)
  }

  // Build Claude input
  const itemsText = batch.map((i) => {
    const customer = Array.isArray(i.customers) ? i.customers[0] : i.customers
    const label = customer ? `${customer.name}${customer.company ? ` (${customer.company})` : ''}` : 'Desconhecido'
    const body = (i.content ?? '').slice(0, 800)
    return JSON.stringify({
      customer_id: i.customer_id,
      type: i.type,
      customer: label,
      subject: i.subject ?? null,
      date: i.occurred_at,
      content: body,
    })
  }).join('\n')

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Analisa estas interações e identifica compromissos de Pedro:\n\n${itemsText}` }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = rawText.match(/\[[\s\S]*\]/)
  const raw = match ? match[0] : '[]'
  let claudeResults: CommitmentResult[] = []
  try {
    claudeResults = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, error: 'Claude devolveu JSON inválido', raw }, { status: 500 })
  }

  // Enrich + skip duplicates
  let skippedExisting = 0
  const results: CommitmentSuggestion[] = []

  for (const r of claudeResults) {
    const interaction = batch.find((i) => i.customer_id === r.customer_id)
    if (!interaction) continue

    // Fuzzy duplicate check
    const existingTitles = openTitles.get(r.customer_id) ?? []
    const titleLower = r.suggested_title.toLowerCase()
    const isDuplicate = existingTitles.some(
      (t) => t.includes(titleLower.slice(0, 15)) || titleLower.includes(t.slice(0, 15))
    )
    if (isDuplicate) { skippedExisting++; continue }

    const customer = Array.isArray(interaction.customers) ? interaction.customers[0] : interaction.customers
    results.push({
      ...r,
      customer_name: customer?.name ?? 'Desconhecido',
      customer_company: customer?.company ?? null,
    })
  }

  return NextResponse.json({ ok: true, results, scanned: batch.length, skipped_existing: skippedExisting })
}
