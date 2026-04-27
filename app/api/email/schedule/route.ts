import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface ScheduleBody {
  customer_id?: string | null
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  attachments?: Array<{ name: string; url: string; mime?: string; size?: number }>
  scheduled_for: string  // ISO timestamp
}

export async function GET() {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('scheduled_emails')
    .select('id, primary_customer_id, to_recipients, cc_recipients, bcc_recipients, subject, scheduled_for, status, attempts, last_error, created_at')
    .in('status', ['pending', 'sending', 'failed'])
    .order('scheduled_for', { ascending: true })
    .limit(100)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, scheduled: data ?? [] })
}

export async function POST(req: Request) {
  let body: ScheduleBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.to || body.to.length === 0 || !body.subject || !body.body || !body.scheduled_for) {
    return NextResponse.json({ ok: false, error: 'to, subject, body, scheduled_for required' }, { status: 400 })
  }

  const scheduledAt = new Date(body.scheduled_for)
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ ok: false, error: 'invalid scheduled_for' }, { status: 400 })
  }
  if (scheduledAt.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ ok: false, error: 'scheduled_for must be in the future' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('scheduled_emails')
    .insert({
      primary_customer_id: body.customer_id ?? null,
      to_recipients:  body.to,
      cc_recipients:  body.cc ?? [],
      bcc_recipients: body.bcc ?? [],
      subject: body.subject,
      body: body.body,
      attachments: body.attachments ?? [],
      scheduled_for: scheduledAt.toISOString(),
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}
