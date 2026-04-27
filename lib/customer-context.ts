import { createServiceClient } from '@/lib/supabase'

type Ticket = { title: string; actual_behavior: string | null; priority: string; status: string }
type FollowUp = { title: string; due_date: string | null; priority: string }
type ContextInteraction = { type: string; subject: string | null; content: string | null; occurred_at: string }

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return ''
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > n ? clean.slice(0, n) + '…' : clean
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

export async function buildCustomerContext(customerId: string, language: 'pt-PT' | 'en'): Promise<string | null> {
  const supabase = createServiceClient()

  const [{ data: customer }, { data: tickets }, { data: followUps }, { data: recent }] = await Promise.all([
    supabase
      .from('customers')
      .select('status, health_score, plan, notes')
      .eq('id', customerId)
      .maybeSingle(),
    supabase
      .from('tickets')
      .select('title, actual_behavior, priority, status')
      .eq('customer_id', customerId)
      .in('status', ['open', 'in-progress'])
      .order('updated_at', { ascending: false })
      .limit(5),
    supabase
      .from('follow_ups')
      .select('title, due_date, priority')
      .eq('customer_id', customerId)
      .eq('status', 'open')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(5),
    supabase
      .from('interactions')
      .select('type, subject, content, occurred_at')
      .eq('customer_id', customerId)
      .in('type', ['meeting', 'whatsapp'])
      .gte('occurred_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('occurred_at', { ascending: false })
      .limit(3),
  ])

  if (!customer && (!tickets || tickets.length === 0) && (!followUps || followUps.length === 0) && (!recent || recent.length === 0)) {
    return null
  }

  const t = tickets as Ticket[] | null
  const f = followUps as FollowUp[] | null
  const r = recent as ContextInteraction[] | null

  const lines: string[] = ['<customer_context>']

  if (customer) {
    const status = customer.status ?? '—'
    const health = customer.health_score ?? '—'
    const plan = customer.plan ?? '—'
    lines.push(`Status: ${status} · Health: ${health}/5 · Plan: ${plan}`)
    if (customer.notes) lines.push(`Notes: ${truncate(customer.notes, 500)}`)
  }

  if (t && t.length > 0) {
    const label = language === 'en' ? `Open tickets (${t.length}):` : `Tickets abertos (${t.length}):`
    lines.push('', label)
    for (const ticket of t) {
      const detail = truncate(ticket.actual_behavior, 200)
      lines.push(`- "${ticket.title}" (${ticket.priority}, ${ticket.status})${detail ? ` — ${detail}` : ''}`)
    }
  }

  if (f && f.length > 0) {
    const label = language === 'en' ? `Open follow-ups (${f.length}):` : `Follow-ups por fazer (${f.length}):`
    lines.push('', label)
    for (const fu of f) {
      const due = fu.due_date ? `due ${fu.due_date}` : (language === 'en' ? 'no date' : 'sem data')
      lines.push(`- "${fu.title}" — ${due} (${fu.priority})`)
    }
  }

  if (r && r.length > 0) {
    const label = language === 'en' ? 'Recent meetings/WhatsApp:' : 'Reuniões/WhatsApp recentes:'
    lines.push('', label)
    for (const i of r) {
      const date = new Date(i.occurred_at).toISOString().slice(0, 10)
      const tag = i.type === 'meeting' ? 'Meeting' : 'WhatsApp'
      const subject = i.subject ? `${i.subject} — ` : ''
      const body = i.content ? truncate(stripHtml(i.content), 300) : ''
      lines.push(`- [${tag} ${date}] ${subject}${body}`)
    }
  }

  lines.push('</customer_context>')
  return lines.join('\n')
}
