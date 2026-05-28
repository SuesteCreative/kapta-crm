import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/slack/webhook',
  // Inngest signs every request with INNGEST_SIGNING_KEY; the serve handler
  // validates the signature itself. Letting the middleware redirect signed
  // Inngest sync probes to /login breaks the integration.
  '/api/inngest',
  // Internal IMAP/cron routes guard themselves with CRON_SECRET via Bearer
  // header (see requireAuth). They must be reachable without the session
  // cookie so Vercel cron and the Inngest function fetch can call them.
  '/api/imap/sync',
  '/api/imap/sync-customer',
  '/api/imap/reparse',
]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow static assets and public paths
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
  ) {
    return NextResponse.next()
  }

  const session = request.cookies.get('kapta_session')?.value
  const validToken = process.env.AUTH_SESSION_TOKEN

  if (!validToken || session !== validToken) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
