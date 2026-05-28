import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { inngest } from '@/lib/inngest/client'

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
export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  await inngest.send({
    name: 'imap/sync.requested',
    data: { trigger: 'manual' },
  })

  return NextResponse.json({ ok: true, dispatched: true })
}
