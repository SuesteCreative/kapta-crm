import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import type { InteractionType, Direction } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

interface BulkInteraction {
  type: InteractionType
  direction: Direction
  content: string
  occurred_at: string
  subject?: string
  metadata?: Record<string, unknown>
}

interface RequestBody {
  customer_id: string
  interactions: BulkInteraction[]
}

export async function POST(request: Request) {
  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { customer_id, interactions } = body

  if (!customer_id || !Array.isArray(interactions) || interactions.length === 0) {
    return NextResponse.json({ ok: false, error: 'customer_id and interactions[] required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const rows = interactions.map((i) => ({
    customer_id,
    type: i.type,
    direction: i.direction,
    content: i.content || null,
    subject: i.subject || null,
    occurred_at: i.occurred_at,
    metadata: i.metadata ?? null,
  }))

  const { error } = await supabase.from('interactions').insert(rows)

  if (error) {
    console.error('Bulk insert error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, count: rows.length })
}
