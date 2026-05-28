import { NextRequest, NextResponse } from 'next/server'
import { runImapSync } from '@/lib/imap/sync-core'

export const dynamic = 'force-dynamic'

/**
 * Thin wrapper around runImapSync(). Two callers:
 *  - Vercel cron (07:00 daily) — calls with no body, gets full sync.
 *  - Manual debugging via Bearer CRON_SECRET.
 *
 * Manual UI dispatches now go through /api/imap/sync-dispatch → Inngest
 * (chunked via continuation events), so this route no longer needs to
 * survive a >60s sync; it stays at the standard 60s Vercel limit.
 */
export async function GET(req: NextRequest) {
  const isVercelCron   = req.headers.get('x-vercel-cron') === '1'
  const sessionCookie  = req.cookies.get('kapta_session')?.value
  const validSession   = process.env.AUTH_SESSION_TOKEN
  const cronSecret     = process.env.CRON_SECRET
  const authHeader     = req.headers.get('authorization')

  const allowed =
    isVercelCron ||
    (validSession && sessionCookie === validSession) ||
    (cronSecret   && authHeader   === `Bearer ${cronSecret}`)

  if (!allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runImapSync()
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 })
  }
  return NextResponse.json(result)
}
