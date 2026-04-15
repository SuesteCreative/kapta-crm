import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface RequestBody {
  customer_id: string
  to: string
  cc?: string
  bcc?: string
  subject: string
  body: string
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function bodyToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

export async function POST(request: Request) {
  let data: RequestBody
  try {
    data = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { customer_id, to, cc, bcc, subject, body } = data

  if (!customer_id || !to || !subject || !body) {
    return NextResponse.json({ ok: false, error: 'customer_id, to, subject, body required' }, { status: 400 })
  }

  // Fetch HTML signature
  const supabaseForSig = createServiceClient()
  const { data: sigRow } = await supabaseForSig
    .from('templates')
    .select('body')
    .eq('name', '__signature__')
    .maybeSingle()

  const sigHtml = sigRow?.body ?? null
  const sigText = sigHtml ? stripHtml(sigHtml) : null

  // Build HTML email: body as HTML + signature
  const htmlEmail = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px;">
${bodyToHtml(body)}
${sigHtml ? `<br><br>${sigHtml}` : ''}
</div>`

  // Plain text fallback
  const textEmail = sigText ? `${body}\n\n--\n${sigText}` : body

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
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
      subject,
      text: textEmail,
      html: htmlEmail,
    })
    messageId = info.messageId
  } catch (err) {
    console.error('SMTP send error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }

  // Log as outbound interaction (store plain text for readability in CRM)
  const supabase = createServiceClient()
  const { error: insertError } = await supabase.from('interactions').insert({
    customer_id,
    type: 'email',
    direction: 'outbound',
    subject,
    content: textEmail,
    source_id: messageId,
    metadata: { source: 'crm', cc: cc ?? null, bcc: bcc ?? null },
    occurred_at: new Date().toISOString(),
  })
  if (insertError) console.error('Failed to log sent email interaction:', insertError.message)

  return NextResponse.json({ ok: true, messageId })
}
