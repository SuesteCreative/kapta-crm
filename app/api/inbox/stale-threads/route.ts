import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const YOU_OWE_HOURS = 24       // customer waiting on Pedro > 24h
const WAITING_DAYS = 5         // Pedro waiting on customer > 5 days
const LOOKBACK_DAYS = 30       // ignore threads older than this

interface InteractionRow {
  id: string
  customer_id: string
  direction: string | null
  subject: string | null
  occurred_at: string
  metadata: Record<string, unknown> | null
}

interface CustomerRow {
  id: string
  name: string | null
  company: string | null
}

export async function GET(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('interactions')
    .select('id, customer_id, direction, subject, occurred_at, metadata')
    .eq('type', 'email')
    .gte('occurred_at', cutoff)
    .order('occurred_at', { ascending: false })
    .limit(2000)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as InteractionRow[]

  // Group by customer; find latest interaction per customer + last outbound timestamp.
  const latest = new Map<string, InteractionRow>()
  const lastOut = new Map<string, string>()
  for (const r of rows) {
    if (!latest.has(r.customer_id)) latest.set(r.customer_id, r)
    if (r.direction === 'outbound') {
      const prev = lastOut.get(r.customer_id)
      if (!prev || r.occurred_at > prev) lastOut.set(r.customer_id, r.occurred_at)
    }
  }

  const now = Date.now()
  const candidates: Array<InteractionRow & { age_hours: number; reason: 'you_owe' | 'waiting_on_customer' }> = []

  for (const [customerId, last] of latest) {
    const ageHours = (now - new Date(last.occurred_at).getTime()) / (1000 * 60 * 60)
    if (last.direction === 'inbound' && ageHours > YOU_OWE_HOURS) {
      candidates.push({ ...last, age_hours: ageHours, reason: 'you_owe' })
    } else if (last.direction === 'outbound' && ageHours > WAITING_DAYS * 24) {
      const lastInbound = rows.find((r) => r.customer_id === customerId && r.direction === 'inbound')
      const lastInboundTs = lastInbound ? new Date(lastInbound.occurred_at).getTime() : 0
      // Only flag if the outbound came after the last inbound (we're waiting, they haven't replied)
      if (new Date(last.occurred_at).getTime() > lastInboundTs) {
        candidates.push({ ...last, age_hours: ageHours, reason: 'waiting_on_customer' })
      }
    }
  }

  // Sort: you_owe first, then by age descending. Boost AI-flagged urgent.
  candidates.sort((a, b) => {
    const aPrio = a.reason === 'you_owe' ? 0 : 1
    const bPrio = b.reason === 'you_owe' ? 0 : 1
    if (aPrio !== bPrio) return aPrio - bPrio
    const aTriage = (a.metadata?.ai_triage as { priority?: string } | undefined)?.priority
    const bTriage = (b.metadata?.ai_triage as { priority?: string } | undefined)?.priority
    const aUrgent = aTriage === 'urgent' || aTriage === 'high' ? 1 : 0
    const bUrgent = bTriage === 'urgent' || bTriage === 'high' ? 1 : 0
    if (aUrgent !== bUrgent) return bUrgent - aUrgent
    return b.age_hours - a.age_hours
  })

  const top = candidates.slice(0, 10)

  // Fetch customer names in one query
  const customerIds = Array.from(new Set(top.map((t) => t.customer_id)))
  let customerMap = new Map<string, CustomerRow>()
  if (customerIds.length > 0) {
    const { data: customers } = await supabase
      .from('customers')
      .select('id, name, company')
      .in('id', customerIds)
    customerMap = new Map((customers ?? []).map((c) => [c.id as string, c as CustomerRow]))
  }

  const threads = top.map((t) => {
    const c = customerMap.get(t.customer_id)
    return {
      id: t.id,
      customer_id: t.customer_id,
      customer_name: c?.name ?? null,
      customer_company: c?.company ?? null,
      subject: t.subject,
      occurred_at: t.occurred_at,
      direction: t.direction,
      age_hours: Math.round(t.age_hours * 10) / 10,
      reason: t.reason,
    }
  })

  return NextResponse.json({ ok: true, threads })
}
