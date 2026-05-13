import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'
import { parseFhIntegrationEmail } from '@/lib/fh-integration-parser'

export const dynamic = 'force-dynamic'

/**
 * Manually flag (or unflag) an interaction as a FareHarbor integration request.
 * Used when an inbound email is a genuine FH request but doesn't match the
 * structured form template (so sync didn't auto-flag it).
 *
 * POST { interaction_id: string, action: 'flag' | 'unflag' }
 *   → { ok: true, flagged: boolean }
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  let body: { interaction_id?: string; action?: 'flag' | 'unflag' }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const interactionId = body.interaction_id
  const action = body.action
  if (!interactionId || (action !== 'flag' && action !== 'unflag')) {
    return NextResponse.json({ ok: false, error: 'Missing interaction_id or action' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: row, error: readErr } = await supabase
    .from('interactions')
    .select('id, content, metadata')
    .eq('id', interactionId)
    .maybeSingle()

  if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ ok: false, error: 'Interaction not found' }, { status: 404 })

  const md = ((row.metadata ?? {}) as Record<string, unknown>)
  if (md.fh_integration_id) {
    return NextResponse.json({ ok: false, error: 'Already converted to integration' }, { status: 409 })
  }

  let nextMd: Record<string, unknown>
  if (action === 'flag') {
    const parsed = parseFhIntegrationEmail((row.content as string | null) ?? '')
    nextMd = { ...md, fh_integration_request: true, fh_parsed: parsed }
  } else {
    const { fh_integration_request: _flag, fh_parsed: _parsed, ...rest } = md
    void _flag; void _parsed
    nextMd = rest
  }

  const { error: upErr } = await supabase
    .from('interactions')
    .update({ metadata: nextMd })
    .eq('id', interactionId)

  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, flagged: action === 'flag' })
}
