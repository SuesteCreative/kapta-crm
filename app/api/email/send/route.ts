import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface RequestBody {
  customer_id: string
  to: string
  subject: string
  body: string
}

export async function POST(request: Request) {
  let data: RequestBody
  try {
    data = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { customer_id, to, subject, body } = data

  if (!customer_id || !to || !subject || !body) {
    return NextResponse.json({ ok: false, error: 'customer_id, to, subject, body required' }, { status: 400 })
  }

  // Fetch signature and append if set
  const supabaseForSig = createServiceClient()
  const { data: sigRow } = await supabaseForSig
    .from('templates')
    .select('body')
    .eq('type', 'signature')
    .eq('name', '__signature__')
    .maybeSingle()
  const fullBody = sigRow?.body
    ? `${body}\n\n--\n${sigRow.body}`
    : body

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    tls: { rejectUnauthorized: false },
  })

  let messageId: string
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject,
      text: fullBody,
    })
    messageId = info.messageId
  } catch (err) {
    console.error('SMTP send error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }

  // Log sent email as outbound interaction (store full body with signature)
  const supabase = createServiceClient()
  await supabase.from('interactions').insert({
    customer_id,
    type: 'email',
    direction: 'outbound',
    subject,
    content: fullBody,
    source_id: messageId,
    occurred_at: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, messageId })
}
