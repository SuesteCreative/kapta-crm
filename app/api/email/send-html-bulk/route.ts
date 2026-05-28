import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase'
import { stripHtml } from '@/lib/html-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface Recipient {
  email: string
  customer_id?: string | null
  name?: string | null
}

interface RequestBody {
  recipients: Recipient[]
  subject: string
  html: string
}

interface SendResult {
  email: string
  customer_id: string | null
  ok: boolean
  error?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  let data: RequestBody
  try {
    data = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const { recipients, subject, html } = data

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return NextResponse.json({ ok: false, error: 'recipients obrigatório' }, { status: 400 })
  }
  if (!subject?.trim() || !html?.trim()) {
    return NextResponse.json({ ok: false, error: 'subject e html obrigatórios' }, { status: 400 })
  }

  // Dedup by lowercase email, validate format
  const seen = new Set<string>()
  const cleaned: Recipient[] = []
  for (const r of recipients) {
    const email = (r.email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) continue
    if (seen.has(email)) continue
    seen.add(email)
    cleaned.push({ email, customer_id: r.customer_id ?? null, name: r.name ?? null })
  }
  if (cleaned.length === 0) {
    return NextResponse.json({ ok: false, error: 'nenhum email válido' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    tls: { rejectUnauthorized: false },
  })

  const textFallback = stripHtml(html)
  const results: SendResult[] = []
  let sent = 0
  let failed = 0

  for (const r of cleaned) {
    try {
      const info = await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: r.email,
        subject,
        text: textFallback,
        html,
      })

      if (r.customer_id) {
        const { error: insertError } = await supabase.from('interactions').insert({
          customer_id: r.customer_id,
          type: 'email',
          direction: 'outbound',
          subject,
          content: textFallback,
          source_id: info.messageId,
          metadata: { source: 'crm', bulk_html: true },
          occurred_at: new Date().toISOString(),
        })
        if (insertError) console.error('interaction insert failed for', r.email, insertError.message)
      }

      results.push({ email: r.email, customer_id: r.customer_id ?? null, ok: true })
      sent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ email: r.email, customer_id: r.customer_id ?? null, ok: false, error: msg })
      failed++
    }
  }

  return NextResponse.json({ ok: true, sent, failed, results })
}
