import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase'
import { plusDaysISO } from '@/lib/commitment-detect'

export const dynamic = 'force-dynamic'

interface Body {
  action: 'done' | 'snooze'
  days?: number
}

/**
 * Act on a follow-up from the emails-page accordion.
 *  - done   → mark completed
 *  - snooze → push due_date out N days (default 7); stays open, drops off the
 *             "due" list until the new date.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { id } = await params
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = createServiceClient()

  let update: Record<string, unknown>
  if (body.action === 'done') {
    update = { status: 'done', completed_at: new Date().toISOString() }
  } else if (body.action === 'snooze') {
    const days = Number.isFinite(body.days) && (body.days as number) > 0 ? Math.floor(body.days as number) : 7
    update = { due_date: plusDaysISO(days) }
  } else {
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  }

  const { error } = await supabase.from('follow_ups').update(update).eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
