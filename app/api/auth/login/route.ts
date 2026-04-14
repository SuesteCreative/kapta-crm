import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  const secret = process.env.AUTH_SECRET!
  const storedHash = process.env.AUTH_PASSWORD_HASH!
  const sessionToken = process.env.AUTH_SESSION_TOKEN!
  const authEmail = process.env.AUTH_EMAIL!

  const inputHash = crypto
    .createHmac('sha256', secret)
    .update(`${email}:${password}`)
    .digest('hex')

  if (email !== authEmail || inputHash !== storedHash) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('kapta_session', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
  return res
}
