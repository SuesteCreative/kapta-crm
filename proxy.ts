import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/api/slack/webhook']

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
