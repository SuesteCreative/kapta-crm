import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Follow-ups that are due: open, with a due_date on or before today.
 * Feeds the "para hoje / atrasados" accordion at the top of the emails page.
 * Each item carries the customer's contacts + the source email (context for
 * the AI draft).
 */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const supabase = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: followUps, error } = await supabase
    .from('follow_ups')
    .select(`
      id, title, description, due_date, priority, source_interaction_id,
      customers ( id, name, company, customer_identifiers ( type, value, is_primary ) )
    `)
    .eq('status', 'open')
    .not('due_date', 'is', null)
    .lte('due_date', today)
    .order('due_date', { ascending: true })
    .limit(50)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // Pull the source emails in one query for draft context.
  const sourceIds = (followUps ?? [])
    .map((f) => f.source_interaction_id)
    .filter((id): id is string => Boolean(id))

  const sourceById = new Map<string, Record<string, unknown>>()
  if (sourceIds.length > 0) {
    const { data: sources } = await supabase
      .from('interactions')
      .select('id, type, direction, subject, content, occurred_at, metadata')
      .in('id', sourceIds)
    for (const s of sources ?? []) sourceById.set(s.id, s)
  }

  const items = (followUps ?? []).map((f) => {
    const customer = Array.isArray(f.customers) ? f.customers[0] : f.customers
    return {
      id: f.id,
      title: f.title,
      description: f.description,
      due_date: f.due_date,
      priority: f.priority,
      overdue: f.due_date ? f.due_date < today : false,
      customer: customer
        ? {
            id: customer.id,
            name: customer.name,
            company: customer.company,
            identifiers: customer.customer_identifiers ?? [],
          }
        : null,
      source: f.source_interaction_id ? sourceById.get(f.source_interaction_id) ?? null : null,
    }
  })

  return NextResponse.json({ ok: true, items, today })
}
