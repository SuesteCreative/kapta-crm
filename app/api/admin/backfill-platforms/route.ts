import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'
import { detectPlatforms } from '@/lib/platform-detector'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Backfill metadata.detected_platforms for existing email interactions.
 * Processes one batch per call (≤ BATCH rows) to stay within Vercel Hobby's
 * 60s function timeout. The client should loop until `has_more` is false.
 *
 * Skips rows that already carry a detected_platforms array, so re-runs are
 * cheap and idempotent.
 *
 * POST → { ok, scanned, updated, has_more }
 */

const BATCH = 300

export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const supabase = createServiceClient()

  // Pull a batch of email interactions that haven't been scanned yet.
  const { data: rows, error } = await supabase
    .from('interactions')
    .select('id, subject, content, metadata')
    .eq('type', 'email')
    .is('metadata->>detected_platforms', null)
    .order('occurred_at', { ascending: false })
    .limit(BATCH)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  let scanned = 0
  let updated = 0
  for (const row of rows ?? []) {
    scanned++
    const md   = (row.metadata ?? {}) as Record<string, unknown>
    const html = (md.html as string | undefined) ?? ''
    const from = (md.matched_email as string | undefined) ?? ''
    const body = `${(row.content as string | null) ?? ''} ${html}`
    const platforms = detectPlatforms(row.subject, body, from)

    // Write the field even when empty (`[]`) so the row stops matching the
    // is-null filter on the next call. Otherwise we'd loop forever on rows
    // that never match any platform.
    const nextMd: Record<string, unknown> = { ...md, detected_platforms: platforms }
    const { error: updErr } = await supabase
      .from('interactions')
      .update({ metadata: nextMd })
      .eq('id', row.id)
    if (!updErr) updated++
  }

  return NextResponse.json({
    ok: true,
    scanned,
    updated,
    has_more: (rows ?? []).length === BATCH,
  })
}
