import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Data-freshness probe for external uptime monitors (UptimeRobot keyword
 * monitor on the literal string FRESH). Public on purpose: it leaks only a
 * single timestamp, and an external watcher is the point — every internal
 * layer (Inngest, Vercel cron, realtime) has already failed silently once.
 *
 * Freshness is judged on created_at (ingestion time), NOT occurred_at
 * (header date) — a forged Date: header must not be able to fake freshness.
 *
 * Threshold 30h: the 07:00 daily cron guarantees at least one ingestion
 * attempt per day even on quiet weekends; 30h tolerates one slow morning
 * without a false alarm. Tune after the first real alert.
 */
const STALE_AFTER_MS = 30 * 60 * 60 * 1000

export async function GET() {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('interactions')
    .select('created_at')
    .eq('type', 'email')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { status: 'STALE', reason: `db error: ${error.message}` },
      { status: 500 },
    )
  }

  const last = data?.created_at ? new Date(data.created_at) : null
  const ageMs = last ? Date.now() - last.getTime() : Number.POSITIVE_INFINITY

  if (!last || ageMs > STALE_AFTER_MS) {
    return NextResponse.json(
      { status: 'STALE', last_ingested_at: last?.toISOString() ?? null },
      { status: 500 },
    )
  }

  return NextResponse.json({
    status: 'FRESH',
    last_ingested_at: last.toISOString(),
    age_minutes: Math.round(ageMs / 60000),
  })
}
