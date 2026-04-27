import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sendEmailCore, type AttachmentInput } from '@/lib/send-email-core'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_ATTEMPTS = 3
const BATCH_SIZE = 25

interface ScheduledRow {
  id: string
  primary_customer_id: string | null
  to_recipients: string[]
  cc_recipients: string[] | null
  bcc_recipients: string[] | null
  subject: string
  body: string
  attachments: AttachmentInput[] | null
  attempts: number
}

export async function GET(request: Request) {
  // Auth: allow Vercel cron or any caller with the right secret/cookie. The Sidebar
  // also pings this endpoint after sync; same-origin browser fetch is fine.
  const isCron = request.headers.get('x-vercel-cron') !== null
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  const allowedSecret = process.env.CRON_SECRET
  const validSecret = allowedSecret && secret === allowedSecret

  // Allow same-origin (browser) callers — no auth needed; the Supabase RLS service-role
  // is what does the actual privileged work, not this entry check.
  // Reject only if it's NOT cron, NOT same-origin, AND secret is wrong.
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  const sameOrigin = origin ? origin.includes(host ?? '') : true
  if (!isCron && !sameOrigin && !validSecret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const nowIso = new Date().toISOString()

  // Pull due rows (status pending OR failed under retry cap)
  const { data: rows, error: fetchError } = await supabase
    .from('scheduled_emails')
    .select('id, primary_customer_id, to_recipients, cc_recipients, bcc_recipients, subject, body, attachments, attempts')
    .lte('scheduled_for', nowIso)
    .or(`status.eq.pending,and(status.eq.failed,attempts.lt.${MAX_ATTEMPTS})`)
    .order('scheduled_for', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchError) {
    return NextResponse.json({ ok: false, error: fetchError.message }, { status: 500 })
  }

  const due = (rows ?? []) as ScheduledRow[]
  if (due.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0 })
  }

  let sent = 0
  let failed = 0

  for (const row of due) {
    // Lease the row by flipping it to "sending" (cheap optimistic lock)
    const { error: leaseError } = await supabase
      .from('scheduled_emails')
      .update({ status: 'sending', attempts: row.attempts + 1, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('attempts', row.attempts)
    if (leaseError) continue

    try {
      await sendEmailCore({
        customer_id: row.primary_customer_id,
        to:  row.to_recipients,
        cc:  row.cc_recipients ?? [],
        bcc: row.bcc_recipients ?? [],
        subject: row.subject,
        body:    row.body,
        attachments: row.attachments ?? [],
      })
      await supabase
        .from('scheduled_emails')
        .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', row.id)
      sent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const giveUp = row.attempts + 1 >= MAX_ATTEMPTS
      await supabase
        .from('scheduled_emails')
        .update({
          status: giveUp ? 'failed' : 'pending',
          last_error: msg.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      failed++
    }
  }

  return NextResponse.json({ ok: true, processed: due.length, sent, failed })
}
