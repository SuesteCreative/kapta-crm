import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface AttachmentInput {
  name: string
  url: string
  mime?: string
  size?: number
}

interface RequestBody {
  customer_id?: string | null
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  subject: string
  body: string
  attachments?: AttachmentInput[]
}

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

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

const IMG_TOKEN = /\[img:(https?:\/\/[^\s\]]+)\]/g

/** Convert plain-text body (with optional [img:URL] tokens) to safe HTML. */
function bodyToHtml(text: string): string {
  // Split on image tokens so we can escape text segments without escaping the URLs.
  const parts: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  IMG_TOKEN.lastIndex = 0
  while ((match = IMG_TOKEN.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index)
    if (before) parts.push(escapeAndBreak(before))
    parts.push(`<img src="${escapeAttr(match[1])}" style="max-width:100%;height:auto;display:block;margin:0.5em 0;" />`)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(escapeAndBreak(text.slice(lastIndex)))
  return parts.join('')
}

function escapeAndBreak(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function asArray(v: string | string[] | undefined | null): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v.map((s) => s.trim()).filter(Boolean)
  return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
}

async function fetchAttachment(att: AttachmentInput): Promise<{ filename: string; content: Buffer; contentType: string | undefined }> {
  const res = await fetch(att.url)
  if (!res.ok) throw new Error(`attachment fetch ${res.status} for ${att.name}`)

  const declared = att.size ?? Number(res.headers.get('content-length') ?? 0)
  if (declared && declared > MAX_ATTACHMENT_BYTES) {
    throw new Error(`attachment ${att.name} exceeds 15MB`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`attachment ${att.name} exceeds 15MB`)
  }

  return {
    filename: att.name,
    content: buffer,
    contentType: att.mime ?? res.headers.get('content-type') ?? undefined,
  }
}

export async function POST(request: Request) {
  let data: RequestBody
  try {
    data = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { customer_id, subject, body, attachments } = data
  const toList  = asArray(data.to)
  const ccList  = asArray(data.cc)
  const bccList = asArray(data.bcc)

  if (toList.length === 0 || !subject || !body) {
    return NextResponse.json({ ok: false, error: 'to, subject, body required' }, { status: 400 })
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

  // Build HTML email: body (with inline image expansion) + signature
  const htmlBody = bodyToHtml(body)
  const htmlEmail = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px;">
${htmlBody}
${sigHtml ? `<br><br>${sigHtml}` : ''}
</div>`

  // Plain text fallback — keep [img:URL] tokens visible
  const textEmail = sigText ? `${body}\n\n--\n${sigText}` : body

  // Resolve attachments (server-side fetch from public bucket)
  let mailerAttachments: Array<{ filename: string; content: Buffer; contentType: string | undefined }> = []
  if (attachments && attachments.length > 0) {
    try {
      mailerAttachments = await Promise.all(attachments.map(fetchAttachment))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ ok: false, error: `Attachment error: ${msg}` }, { status: 400 })
    }
  }

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
      to: toList,
      ...(ccList.length > 0  ? { cc: ccList }   : {}),
      ...(bccList.length > 0 ? { bcc: bccList } : {}),
      subject,
      text: textEmail,
      html: htmlEmail,
      ...(mailerAttachments.length > 0 ? { attachments: mailerAttachments } : {}),
    })
    messageId = info.messageId
  } catch (err) {
    console.error('SMTP send error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }

  // Log as outbound interaction (only when targeted at a known customer)
  if (customer_id) {
    const supabase = createServiceClient()
    const { error: insertError } = await supabase.from('interactions').insert({
      customer_id,
      type: 'email',
      direction: 'outbound',
      subject,
      content: textEmail,
      source_id: messageId,
      metadata: {
        source: 'crm',
        cc: ccList.length > 0 ? ccList.join(', ') : null,
        bcc: bccList.length > 0 ? bccList.join(', ') : null,
        attachments: attachments?.map((a) => ({ name: a.name, mime: a.mime, size: a.size, url: a.url })) ?? null,
      },
      occurred_at: new Date().toISOString(),
    })
    if (insertError) console.error('Failed to log sent email interaction:', insertError.message)
  }

  return NextResponse.json({ ok: true, messageId })
}
