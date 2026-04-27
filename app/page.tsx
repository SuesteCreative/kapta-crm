export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase'
import { DashboardClient } from '@/components/dashboard-client'

type RawEmail = {
  id: string
  customer_id: string
  direction: string | null
  subject: string | null
  occurred_at: string
  metadata: Record<string, unknown> | null
  customers: { id: string; name: string; company: string | null } | { id: string; name: string; company: string | null }[] | null
}

const PRIO_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

async function getDashboardData() {
  const supabase = createServiceClient()
  const today = new Date().toISOString().split('T')[0]

  const [overdueRes, todayRes, customersRes, openTicketsRes, emailsRes] = await Promise.all([
    supabase
      .from('follow_ups')
      .select('*, customers(name, company)')
      .eq('status', 'open')
      .lt('due_date', today)
      .order('due_date', { ascending: true }),
    supabase
      .from('follow_ups')
      .select('*, customers(name, company)')
      .eq('status', 'open')
      .eq('due_date', today)
      .order('priority', { ascending: false }),
    supabase
      .from('customers')
      .select('id, status')
      .neq('status', 'churned'),
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open'),
    // Emails to compute who needs a reply + AI actions.
    // Only inbound rows are rendered, so filter server-side to halve the row pull.
    supabase
      .from('interactions')
      .select('id, customer_id, direction, subject, occurred_at, metadata, customers(id, name, company)')
      .eq('type', 'email')
      .eq('direction', 'inbound')
      .order('occurred_at', { ascending: false })
      .limit(100),
  ])

  // Compute: most recent inbound email per customer
  const allEmails = (emailsRes.data ?? []) as RawEmail[]
  const byCustomer = new Map<string, RawEmail>()
  for (const e of allEmails) {
    if (!byCustomer.has(e.customer_id)) byCustomer.set(e.customer_id, e)
  }

  const emailActions: {
    customerId: string
    customerName: string
    company: string | null
    subject: string | null
    daysWaiting: number
    aiPriority: string | null
    aiAction: string | null
    aiSummary: string | null
    aiCategory: string | null
  }[] = []

  for (const [, e] of byCustomer) {
    if (e.direction !== 'inbound') continue
    const customer = Array.isArray(e.customers) ? e.customers[0] : e.customers
    const triage = e.metadata?.ai_triage as { priority: string; action: string; summary: string; category: string } | undefined
    const daysWaiting = Math.floor((Date.now() - new Date(e.occurred_at).getTime()) / 86_400_000)
    emailActions.push({
      customerId: e.customer_id,
      customerName: customer?.name ?? 'Desconhecido',
      company: customer?.company ?? null,
      subject: e.subject ?? null,
      daysWaiting,
      aiPriority: triage?.priority ?? null,
      aiAction: triage?.action ?? null,
      aiSummary: triage?.summary ?? null,
      aiCategory: triage?.category ?? null,
    })
  }

  // Sort: AI priority first, then days waiting
  emailActions.sort((a, b) => {
    const pa = PRIO_ORDER[a.aiPriority ?? ''] ?? 4
    const pb = PRIO_ORDER[b.aiPriority ?? ''] ?? 4
    if (pa !== pb) return pa - pb
    return b.daysWaiting - a.daysWaiting
  })

  return {
    overdue: overdueRes.data ?? [],
    today: todayRes.data ?? [],
    customers: customersRes.data ?? [],
    openTickets: openTicketsRes.count ?? 0,
    emailActions: emailActions.slice(0, 10),
    totalNeedsReply: emailActions.length,
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData()
  return <DashboardClient data={data} />
}
