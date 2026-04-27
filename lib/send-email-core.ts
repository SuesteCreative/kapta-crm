import nodemailer from 'nodemailer'
import { createServiceClient } from '@/lib/supabase'

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

export interface AttachmentInput {
  name: string
  url: string
  mime?: string
  size?: number
}

export interface SendInput {
  customer_id?: string | null
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  attachments?: AttachmentInput[]
}

const IMG_TOKEN = /\[img:(https?:\/\/[^\s\]]+)\]/g

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

export function bodyToHtml(text: string): string {
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

async function fetchAttachment(att: AttachmentInput) {
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

export interface SendResult {
  messageId: string
}

/** Send an email via SMTP and log it as an outbound interaction when customer_id is known. */
export async function sendEmailCore(input: SendInput): Promise<SendResult> {
  const { customer_id, to, cc = [], bcc = [], subject, body, attachments = [] } = input

  if (to.length === 0 || !subject || !body) {
    throw new Error('to, subject, body required')
  }

  const supabase = createServiceClient()

  const { data: sigRow } = await supabase
    .from('templates')
    .select('body')
    .eq('name', '__signature__')
    .maybeSingle()

  const sigHtml = sigRow?.body ?? null
  const sigText = sigHtml ? stripHtml(sigHtml) : null

  const htmlEmail = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px;">
${bodyToHtml(body)}
${sigHtml ? `<br><br>${sigHtml}` : ''}
</div>`

  const textEmail = sigText ? `${body}\n\n--\n${sigText}` : body

  const mailerAttachments = attachments.length > 0
    ? await Promise.all(attachments.map(fetchAttachment))
    : []

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

  const info = await transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    ...(cc.length > 0  ? { cc }   : {}),
    ...(bcc.length > 0 ? { bcc } : {}),
    subject,
    text: textEmail,
    html: htmlEmail,
    ...(mailerAttachments.length > 0 ? { attachments: mailerAttachments } : {}),
  })

  if (customer_id) {
    const { error: insertError } = await supabase.from('interactions').insert({
      customer_id,
      type: 'email',
      direction: 'outbound',
      subject,
      content: textEmail,
      source_id: info.messageId,
      metadata: {
        source: 'crm',
        cc:  cc.length  > 0 ? cc.join(', ')  : null,
        bcc: bcc.length > 0 ? bcc.join(', ') : null,
        attachments: attachments.map((a) => ({ name: a.name, mime: a.mime, size: a.size, url: a.url })),
      },
      occurred_at: new Date().toISOString(),
    })
    if (insertError) console.error('Failed to log sent email interaction:', insertError.message)
  }

  return { messageId: info.messageId }
}
