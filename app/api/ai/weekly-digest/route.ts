import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT = `És um assistente de negócio que prepara resumos semanais para Pedro, um account manager português B2B na Kapta.

Dado um conjunto de dados da semana (interações, follow-ups, tickets), escreve um resumo executivo breve e acionável.

Formato de resposta — um JSON com:
- headline: string (1 frase que captura o estado geral da semana, ex: "Semana movimentada: 3 clientes urgentes, 5 follow-ups concluídos")
- highlights: string[] (3-5 pontos mais importantes da semana — conquistas, problemas críticos, clientes que precisam atenção)
- urgent: string[] (0-3 ações urgentes para os próximos dias)
- note: string (observação opcional sobre tendências ou padrões, pode ser vazia "")

Regras:
- Escreve em português europeu, direto e profissional
- Usa nomes reais dos clientes quando relevante
- Foca no que Pedro precisa FAZER, não apenas no que aconteceu
- Retorna APENAS JSON válido, sem markdown`

export async function POST() {
  const supabase = createServiceClient()
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const today = new Date().toISOString().split('T')[0]

  // Fetch last 7 days of interactions (limited, no content)
  const [
    { data: interactions },
    { data: openFollowUps },
    { data: overdueFollowUps },
    { data: openTickets },
  ] = await Promise.all([
    supabase
      .from('interactions')
      .select('customer_id, type, direction, subject, occurred_at, customers(name, company)')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(100),
    supabase
      .from('follow_ups')
      .select('title, priority, due_date, customers(name)')
      .eq('status', 'open')
      .limit(30),
    supabase
      .from('follow_ups')
      .select('title, customers(name)')
      .eq('status', 'open')
      .lt('due_date', today)
      .limit(10),
    supabase
      .from('tickets')
      .select('title, priority, status, customers(name)')
      .in('status', ['open', 'in-progress'])
      .limit(20),
  ])

  // Build summary text for Claude
  const interactionLines = (interactions ?? []).map((i) => {
    const c = Array.isArray(i.customers) ? i.customers[0] : i.customers
    const name = c ? `${c.name}${c.company ? ` (${c.company})` : ''}` : 'desconhecido'
    const dir = i.direction === 'inbound' ? '→ recebido de' : '← enviado a'
    const subject = i.subject ? ` "${i.subject}"` : ''
    return `${i.type} ${dir} ${name}${subject}`
  }).join('\n')

  const followUpLines = (openFollowUps ?? []).map((f) => {
    const c = Array.isArray(f.customers) ? f.customers[0] : f.customers
    const overdue = f.due_date && f.due_date < today ? ' [ATRASADO]' : ''
    return `• ${f.priority.toUpperCase()}${overdue} — ${f.title} (${c?.name ?? '?'})`
  }).join('\n')

  const overdueNames = (overdueFollowUps ?? []).map((f) => {
    const c = Array.isArray(f.customers) ? f.customers[0] : f.customers
    return `${f.title} (${c?.name ?? '?'})`
  }).join(', ')

  const ticketLines = (openTickets ?? []).map((t) => {
    const c = Array.isArray(t.customers) ? t.customers[0] : t.customers
    return `• ${t.priority.toUpperCase()} [${t.status}] — ${t.title} (${c?.name ?? '?'})`
  }).join('\n')

  const prompt = `Resumo semanal — ${new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}

INTERAÇÕES ESTA SEMANA (${(interactions ?? []).length} total):
${interactionLines || '(nenhuma)'}

FOLLOW-UPS EM ABERTO (${(openFollowUps ?? []).length} total, ${(overdueFollowUps ?? []).length} atrasados):
${followUpLines || '(nenhum)'}
${overdueNames ? `\nAtrasados: ${overdueNames}` : ''}

TICKETS ABERTOS (${(openTickets ?? []).length} total):
${ticketLines || '(nenhum)'}

Gera o resumo executivo da semana.`

  const memory = await getAiMemory()

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let message
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [{ type: 'text', text: `${SYSTEM_PROMPT}${memorySystemBlock(memory)}`, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Claude API error:', msg)
    return NextResponse.json({ ok: false, error: `Claude error: ${msg}` }, { status: 500 })
  }

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = rawText.match(/\{[\s\S]*\}/)
  if (!match) {
    console.error('Claude non-JSON response:', rawText.slice(0, 200))
    return NextResponse.json({ ok: false, error: 'Claude returned unexpected format' }, { status: 500 })
  }

  try {
    const result = JSON.parse(match[0])
    return NextResponse.json({ ok: true, ...result })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao processar resposta.' }, { status: 500 })
  }
}
