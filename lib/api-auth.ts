import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Standard auth gate for API routes. Mirrors the pattern in /api/imap/sync:
 * accept Vercel cron header, a kapta_session cookie that matches AUTH_SESSION_TOKEN,
 * or a Bearer token that matches CRON_SECRET. Reject everything else with 401.
 */
export function requireAuth(req: NextRequest | Request): NextResponse | null {
  const headers = req.headers
  const cookieHeader = headers.get('cookie') ?? ''
  const sessionCookie = parseCookie(cookieHeader, 'kapta_session')

  const isVercelCron = headers.get('x-vercel-cron') === '1'
  const validSession = process.env.AUTH_SESSION_TOKEN
  const cronSecret   = process.env.CRON_SECRET
  const authHeader   = headers.get('authorization')

  const allowed =
    isVercelCron ||
    (validSession && sessionCookie === validSession) ||
    (cronSecret   && authHeader   === `Bearer ${cronSecret}`)

  if (!allowed) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

function parseCookie(header: string, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}
