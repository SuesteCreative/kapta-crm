import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'
import { parseFhIntegrationEmail } from '@/lib/fh-integration-parser'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Re-scan all stored emails for the FareHarbor integration form template and
 * flag any that aren't yet flagged, so they surface in the "Por contactar" list.
 *
 * Matches by BODY content ("A new integration has been submitted via the
 * FareHarbor <> Kapta form"), not by sender — this is what catches emails that
 * the live classifier missed, most importantly ones a team member FORWARDED
 * (sender = someone@kapta.pt instead of site@kapta.pt). The parser still pulls
 * the partner email/shortname from the quoted template body, so a forwarded
 * copy and the original collapse to a single pending row on the page.
 *
 * Never touches rows already converted to an integration (fh_integration_id set).
 *
 * The fh_integration_id/fh_integration_request checks used to run in JS after
 * fetching every matching row's full content+metadata — meaning every click
 * re-downloaded the entire matched history (growing without bound) just to
 * throw away the ones already handled. Pushed into the query instead, so
 * only never-yet-flagged rows are fetched.
 *
 * POST → { ok, scanned, flagged }
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const supabase = createServiceClient()

  const { data: rows, error } = await supabase
    .from('interactions')
    .select('id, content, metadata')
    .ilike('content', '%new integration has been submitted via the fareharbor%')
    .filter('metadata->>fh_integration_id', 'is', null)
    .filter('metadata->>fh_integration_request', 'is', null)
    .order('occurred_at', { ascending: false })
    .limit(2000)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  let flagged = 0
  const scanned = (rows ?? []).length

  for (const r of rows ?? []) {
    const md = (r.metadata ?? {}) as Record<string, unknown>

    const body = (r.content as string | null) ?? ''
    if (!body) continue

    const parsed = parseFhIntegrationEmail(body)
    const { error: upErr } = await supabase
      .from('interactions')
      .update({ metadata: { ...md, fh_integration_request: true, fh_parsed: parsed } })
      .eq('id', r.id)
    if (!upErr) flagged++
  }

  return NextResponse.json({ ok: true, scanned, flagged })
}
