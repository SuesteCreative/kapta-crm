import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Supabase keep-alive.
 *
 * Free-tier Supabase projects are paused after ~7 days without activity, which
 * would break the live CRM until manually unpaused. The daily IMAP sync already
 * touches the DB, but it runs through Inngest and can fail silently for days —
 * if that ever happens long enough, the project pauses.
 *
 * This is a dead-simple, dependency-free heartbeat: a Vercel cron hits it daily
 * and it issues one trivial query straight through the Supabase API gateway
 * (the request that actually counts as "activity"). No Inngest, nothing to fail.
 * Scheduled ~12h apart from the 07:00 sync so the DB is touched twice a day.
 */
async function ping() {
  const supabase = createServiceClient()
  // head + count = hits Postgres, returns no rows. Cheapest possible read.
  const { error, count } = await supabase
    .from('customers')
    .select('id', { head: true, count: 'exact' })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, alive: true, customers: count ?? null })
}

// Vercel cron always sends GET.
export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied
  return ping()
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied
  return ping()
}
