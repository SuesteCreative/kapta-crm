import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface RequestBody {
  customer_ids: string[]
  subject: string
  body: string
}

type SendResult = {
  customer_id: string
  email: string
  ok: boolean
  error?: string
}

export async function POST(request: Request) {
  let data: RequestBody
  try {
    data = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const { customer_ids, subject, body } = data

  if (!Array.isArray(customer_ids) || customer_ids.length === 0 || !subject?.trim() || !body?.trim()) {
    return NextResponse.json({ ok: false, error: 'customer_ids, subject e body são obrigatórios' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Resolve primary email per customer in one query
  const { data: identifiers } = await supabase
    .from('customer_identifiers')
    .select('customer_id, value, is_primary')
    .in('customer_id', customer_ids)
    .eq('type', 'email')
    .order('is_primary', { ascending: false })

  // customer_id → email (prefer is_primary=true, first wins due to order)
  const emailMap = new Map<string, string>()
  for (const row of identifiers ?? []) {
    if (!emailMap.has(row.customer_id)) emailMap.set(row.customer_id, row.value)
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    tls: { rejectUnauthorized: false },
  })

  const results: SendResult[] = []
  let sent = 0
  let failed = 0

  for (const customerId of customer_ids) {
    const email = emailMap.get(customerId)
    if (!email) {
      results.push({ customer_id: customerId, email: '', ok: false, error: 'Email não encontrado' })
      failed++
      continue
    }

    try {
      const info = await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: email,
        subject,
        text: body,
      })

      // Log as outbound interaction
      await supabase.from('interactions').insert({
        customer_id: customerId,
        type: 'email',
        direction: 'outbound',
        subject,
        content: body,
        source_id: info.messageId,
        occurred_at: new Date().toISOString(),
      })

      results.push({ customer_id: customerId, email, ok: true })
      sent++
    } catch (err) {
      results.push({ customer_id: customerId, email, ok: false, error: String(err) })
      failed++
    }
  }

  return NextResponse.json({ ok: true, sent, failed, results })
}
