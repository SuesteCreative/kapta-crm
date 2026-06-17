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

    const signIn = await anonClient.auth.signInWithPassword({
      email: authEmail,
      password: supabasePassword,
    })
    let data = signIn.data
    const error = signIn.error

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
    } else if (error) {
      // Surface — do NOT swallow. A failed Supabase sign-in means the browser
      // stays on the anon role and EVERY client-side DB read/write is silently
      // RLS-blocked app-wide. This degraded silently for ~2 months when the
      // legacy anon key was disabled. Loud logs make the next break obvious.
      console.error('[login] Supabase sign-in failed — browser will lack a JWT (RLS will block all client queries):', error.message)
    }
  } catch (e) {
    console.error('[login] Supabase Auth threw — continuing with cookie-only auth (client DB queries will fail):', e)
  }

  const res = NextResponse.json({
    ok: true,
    access_token: accessToken,
    refresh_token: refreshToken,
    supabase_session: !!(accessToken && refreshToken),
  })
  res.cookies.set('kapta_session', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
  return res
}
