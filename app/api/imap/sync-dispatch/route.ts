import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { inngest } from '@/lib/inngest/client'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Fire-and-forget IMAP sync. Dispatches an Inngest event and returns
 * immediately — the sidebar shows a "syncing started" toast and the
 * <JobToaster /> listens to job_status realtime updates for completion.
 *
 * Why this exists (vs. calling /api/imap/sync directly): the old route
 * runs the full IMAP fetch + parse + insert inline and can take 30-60s,
 * blocking the user's next navigation. Dispatching to Inngest decouples
 * the work from the request lifecycle and gives us retries on failure.
 */

/**
 * Backpressure: with the sidebar button, the emails-page auto-sync, focus
 * listeners and the daily cron all able to dispatch, a slow run used to
 * collect a pile of queued events behind the function's concurrency:1 slot
 * (the 2026-06-11..12 backlog). If a sync started <10 min ago is still
 * running, skip the dispatch — the active run already covers this request.
 * The 10-min cutoff plus the stale-row sweeper in the Inngest function
 * keeps a stranded 'running' row from deadlocking dispatch forever.
 */
async function dispatch(trigger: 'manual' | 'cron') {
  const supabase = createServiceClient()
  const { data: active } = await supabase
    .from('job_status')
    .select('id, started_at')
    .eq('kind', 'imap_sync')
    .eq('status', 'running')
    .gte('started_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle()

  if (active) {
    return NextResponse.json({ ok: true, dispatched: false, alreadyRunning: true, jobId: active.id })
  }

  await inngest.send({
    name: 'imap/sync.requested',
    data: { trigger },
  })
  return NextResponse.json({ ok: true, dispatched: true, trigger })
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied
  return dispatch('manual')
}

/**
 * GET handler exists for Vercel cron — the platform always sends GET. This
 * lets us redirect the daily cron at /api/imap/sync (which historically ran
 * the whole sync inline under the 60s budget) to the chunked Inngest path,
 * so a growing backlog never trips the cron either.
 */
export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied
  return dispatch('cron')
}
