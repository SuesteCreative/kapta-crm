import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  const secret       = process.env.AUTH_SECRET!
  const storedHash   = process.env.AUTH_PASSWORD_HASH!
  const sessionToken = process.env.AUTH_SESSION_TOKEN!
  const authEmail    = process.env.AUTH_EMAIL!

  // 1. Validate custom credentials
  const inputHash = crypto
    .createHmac('sha256', secret)
    .update(`${email}:${password}`)
    .digest('hex')

  if (email !== authEmail || inputHash !== storedHash) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 })
  }

  // 2. Get a Supabase Auth session so the browser client has a real JWT for RLS
  //    The Supabase password is derived deterministically from AUTH_SECRET — never stored plain.
  const supabasePassword = crypto
    .createHmac('sha256', secret)
    .update(`supabase-session:${authEmail}`)
    .digest('hex')

  let accessToken: string | null = null
  let refreshToken: string | null = null

  try {
    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    )

    let { data, error } = await anonClient.auth.signInWithPassword({
      email: authEmail,
      password: supabasePassword,
    })

    // First-time setup: Supabase Auth user doesn't exist yet — create it
    if (error && (error.message.includes('Invalid login credentials') || error.status === 400)) {
      const serviceClient = createServiceClient()
      await serviceClient.auth.admin.createUser({
        email: authEmail,
        password: supabasePassword,
        email_confirm: true,
      })
      const retry = await anonClient.auth.signInWithPassword({
        email: authEmail,
        password: supabasePassword,
      })
      data = retry.data
    }

    if (data?.session) {
      accessToken  = data.session.access_token
      refreshToken = data.session.refresh_token
    }
  } catch {
    // Supabase Auth unavailable — continue with cookie-only auth.
    // Browser-direct DB queries will fail until session is restored on next login.
  }

  const res = NextResponse.json({ ok: true, access_token: accessToken, refresh_token: refreshToken })
  res.cookies.set('kapta_session', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
  return res
}
