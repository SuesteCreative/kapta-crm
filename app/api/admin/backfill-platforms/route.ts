import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'
import { detectPlatforms } from '@/lib/platform-detector'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Backfill metadata.detected_platforms for existing email interactions.
 * Scans subject + content + metadata.html and writes the detector's output.
 * Idempotent — re-running on the same row just overwrites with the same value.
 *
 * POST → { ok, scanned, updated }
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const supabase = createServiceClient()

  const { data: rows, error } = await supabase
    .from('interactions')
    .select('id, subject, content, metadata')
    .eq('type', 'email')
    .order('occurred_at', { ascending: false })
    .limit(5000)

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

    const existing = Array.isArray(md.detected_platforms) ? (md.detected_platforms as string[]) : []
    const sameSet  = existing.length === platforms.length && existing.every((k, i) => k === platforms[i])
    if (sameSet) continue

    const nextMd: Record<string, unknown> = { ...md }
    if (platforms.length > 0) {
      nextMd.detected_platforms = platforms
    } else {
      delete nextMd.detected_platforms
    }
    const { error: updErr } = await supabase
      .from('interactions')
      .update({ metadata: nextMd })
      .eq('id', row.id)
    if (!updErr) updated++
  }

  return NextResponse.json({ ok: true, scanned, updated })
}
