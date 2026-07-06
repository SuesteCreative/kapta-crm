import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase'
import { getTransporter } from '@/lib/send-email-core'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Daily follow-up digest.
 *
 * Runs once each morning (Vercel cron). Emails Pedro — to his own mailbox, so
 * it lands in the emails cockpit where he works — the follow-ups due today or
 * overdue, each with the customer's contacts and a deep link back into the app
 * (where the AI draft is generated on open). Marks `reminder_last_sent` so the
 * same item isn't re-sent the same day.
 *
 * Vercel Hobby only allows daily crons, so this is a morning digest rather than
 * a to-the-minute reminder — see 2026-04-27-drop-scheduled-emails.sql.
 */

function ownerEmail(): string | null {
  return (
    process.env.OWNER_EMAIL ||
    process.env.ALERT_EMAIL ||
    process.env.AUTH_EMAIL ||
    process.env.SMTP_USER ||
    null
  )
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://kapta-crm.vercel.app').replace(/\/$/, '')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function run() {
  const supabase = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: rows, error } = await supabase
    .from('follow_ups')
    .select(`
      id, title, due_date, priority,
      customers ( name, company, customer_identifiers ( type, value, is_primary ) )
    `)
    .eq('status', 'open')
    .not('due_date', 'is', null)
    .lte('due_date', today)
    .or(`reminder_last_sent.is.null,reminder_last_sent.neq.${today}`)
    .order('due_date', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ ok: true, sent: 0, message: 'Nenhum follow-up para hoje.' })

  const to = ownerEmail()
  if (!to) return NextResponse.json({ ok: false, error: 'no owner email configured' }, { status: 500 })

  const base = appUrl()
  const listHtml = rows.map((f) => {
    const c = Array.isArray(f.customers) ? f.customers[0] : f.customers
    const idents = (c?.customer_identifiers ?? []) as Array<{ type: string; value: string; is_primary: boolean }>
    const emails = idents.filter((i) => i.type === 'email').map((i) => i.value)
    const phones = idents.filter((i) => i.type === 'phone' || i.type === 'whatsapp').map((i) => i.value)
    const overdue = f.due_date! < today
    const contacts = [...emails, ...phones].map(esc).join(' · ') || '—'
    return `<li style="margin:0 0 12px;">
      <strong>${esc(c?.name ?? 'Cliente')}</strong>${c?.company ? ` · ${esc(c.company)}` : ''}
      ${overdue ? `<span style="color:#dc2626;font-size:12px;"> (atrasado desde ${esc(f.due_date!)})</span>` : ''}
      <br><span style="color:#333;">${esc(f.title)}</span>
      <br><span style="color:#666;font-size:12px;">${contacts}</span>
    </li>`
  }).join('')

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px;">
    <p>Bom dia Pedro — tens <strong>${rows.length}</strong> follow-up${rows.length === 1 ? '' : 's'} para contactar hoje:</p>
    <ul style="padding-left:18px;">${listHtml}</ul>
    <p><a href="${base}/emails" style="color:#5b5bd6;font-weight:bold;">Abrir no Kapta →</a> (o rascunho de email gera-se ao abrir cada follow-up)</p>
  </div>`

  const text = `Bom dia Pedro — ${rows.length} follow-up(s) para hoje:\n\n` +
    rows.map((f) => {
      const c = Array.isArray(f.customers) ? f.customers[0] : f.customers
      return `- ${c?.name ?? 'Cliente'}: ${f.title}`
    }).join('\n') +
    `\n\nAbrir: ${base}/emails`

  await getTransporter().sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: `☕ ${rows.length} follow-up${rows.length === 1 ? '' : 's'} para hoje`,
    text,
    html,
  })

  const ids = rows.map((f) => f.id)
  const { error: updateError } = await supabase
    .from('follow_ups')
    .update({ reminder_last_sent: today })
    .in('id', ids)
  if (updateError) console.error('digest reminder_last_sent update failed:', updateError.message)

  return NextResponse.json({ ok: true, sent: rows.length })
}

// Vercel cron always sends GET.
export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied
  return run()
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied
  return run()
}
