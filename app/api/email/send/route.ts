import { NextResponse } from 'next/server'
import { sendEmailCore, type AttachmentInput } from '@/lib/send-email-core'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface RequestBody {
  customer_id?: string | null
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  subject: string
  body: string
  attachments?: AttachmentInput[]
}

function asArray(v: string | string[] | undefined | null): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v.map((s) => s.trim()).filter(Boolean)
  return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
}

export async function POST(request: Request) {
  let data: RequestBody
  try {
    data = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const { messageId } = await sendEmailCore({
      customer_id: data.customer_id ?? null,
      to:  asArray(data.to),
      cc:  asArray(data.cc),
      bcc: asArray(data.bcc),
      subject: data.subject,
      body: data.body,
      attachments: data.attachments ?? [],
    })
    return NextResponse.json({ ok: true, messageId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('SMTP send error:', msg)
    const status = msg.includes('required') || msg.includes('exceeds') ? 400 : 500
    return NextResponse.json({ ok: false, error: msg }, { status })
  }
}
