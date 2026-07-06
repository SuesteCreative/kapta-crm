import { randomUUID } from 'node:crypto'
import { getTransporter } from '@/lib/send-email-core'

/**
 * Emails Pedro an .ics calendar invite for a follow-up.
 *
 * This is the "Google Calendar" integration without any OAuth: an iCalendar
 * REQUEST sent to Pedro's own address. Google Calendar (and every other
 * client) auto-adds the event and fires the reminder alarm on his phone.
 * Re-sending with the same UID (the follow-up id) updates the same event.
 *
 * Never throws — a calendar failure must not break email sending.
 */

/** Owner mailbox that receives reminders. */
function ownerEmail(): string | null {
  return (
    process.env.OWNER_EMAIL ||
    process.env.ALERT_EMAIL ||
    process.env.AUTH_EMAIL ||
    process.env.SMTP_USER ||
    null
  )
}

/** RFC 5545 text escaping. */
function ics(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** UTC timestamp in iCalendar compact form: 20260713T090000Z */
function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Floating (local-time) form for a given YYYY-MM-DD at HH:00. */
function floatingAt(dateISO: string, hour: number): string {
  const hh = String(hour).padStart(2, '0')
  return `${dateISO.replace(/-/g, '')}T${hh}0000`
}

export interface CalendarInviteInput {
  title: string
  /** YYYY-MM-DD */
  dueDateISO: string
  /** Follow-up id — used as the stable event UID so re-sends update the event. */
  followUpId?: string
  /** Client details, so the reminder actually says who to contact. */
  customerName?: string | null
  customerEmail?: string | null
  customerCompany?: string | null
}

export async function sendCalendarInvite(input: CalendarInviteInput): Promise<void> {
  const to = ownerEmail()
  if (!to) {
    console.error('sendCalendarInvite: no owner email configured (OWNER_EMAIL/ALERT_EMAIL/AUTH_EMAIL/SMTP_USER)')
    return
  }

  const who = input.customerName?.trim() || 'cliente'
  const detailLines = [
    `Cliente: ${input.customerName ?? '—'}`,
    input.customerCompany ? `Empresa: ${input.customerCompany}` : null,
    input.customerEmail ? `Email: ${input.customerEmail}` : null,
    `Assunto: ${input.title}`,
  ].filter((l): l is string => Boolean(l))
  const detailText = detailLines.join('\n')

  const uid = `${input.followUpId ?? randomUUID()}@kapta.pt`
  const start = floatingAt(input.dueDateISO, 9)      // 09:00 local
  const end = floatingAt(input.dueDateISO, 9).replace('T090000', 'T093000')
  const summary = ics(`Contactar ${who}: ${input.title}`)
  const description = ics(`${detailText}\n\nLembrete criado pelo Kapta CRM.`)

  const content = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kapta CRM//Follow-up//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `ORGANIZER;CN=Kapta CRM:mailto:${to}`,
    `ATTENDEE;CN=Pedro;RSVP=FALSE;PARTSTAT=ACCEPTED:mailto:${to}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${summary}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: `📅 Follow-up: ${who} — ${input.title}`,
      text: `Lembrete de follow-up para ${input.dueDateISO}:\n\n${detailText}`,
      icalEvent: { method: 'REQUEST', filename: 'follow-up.ics', content },
    })
  } catch (err) {
    console.error('sendCalendarInvite error:', err instanceof Error ? err.message : String(err))
  }
}
