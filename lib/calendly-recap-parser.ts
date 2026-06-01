// Parse the "Your meeting recap is now available" email Calendly Notetaker sends
// after each meeting (from notifications@calendly.com). Calendly exposes no API
// for recap content, so the email is the only no-Zapier way in. We turn it into
// a `type='meeting'` interaction. Mirrors lib/fh-integration-parser.ts.

export interface CalendlyRecap {
  title: string
  occurredAt: string | null   // ISO; null → caller falls back to the email's date
  attendeeNames: string[]      // display NAMES (Calendly recaps carry no emails)
  recapUrl: string | null
  summary: string
  discussion: string
}

const RECAP_SUBJECT_RE = /your meeting recap is now available/i
const DATE_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i
const TIME_RE = /(\d{1,2}:\d{2})\s*[–—-]\s*\d{1,2}:\d{2}\s*(am|pm)?/i

/** True if this is a Calendly recap email. Sender-gated to avoid false positives. */
export function isCalendlyRecapEmail(
  fromAddress: string | null | undefined,
  subject: string | null | undefined,
  body: string | null | undefined,
): boolean {
  const from = (fromAddress ?? '').trim().toLowerCase()
  if (!/@calendly\.com$/i.test(from)) return false
  if (subject && RECAP_SUBJECT_RE.test(subject)) return true
  // Subject fallback: the body carries the recap structure.
  return !!body && /^\s*Summary\s*$/im.test(body) && /^\s*Discussion\s*$/im.test(body)
}

/** Pull the recap/recording link out of the body (or HTML). Skips footer/help links. */
function findRecapUrl(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s<>"')]+/g) ?? []
  const calendly = urls.filter((u) => /calendly\.com/i.test(u))
  const skip = /(unsubscribe|preferences|\/help|email-settings|\/events\/[^/]+\/(google_meet|zoom|teams)|legal|terms)/i
  const cleaned = calendly.filter((u) => !skip.test(u))
  const preferred = cleaned.find((u) => /(recap|recording|meeting|notetaker)/i.test(u))
  return preferred ?? cleaned[0] ?? calendly[0] ?? null
}

/** Text between a heading line and the next section heading (or end). */
function sectionBetween(text: string, start: RegExp, ends: RegExp[]): string {
  const m = start.exec(text)
  if (!m) return ''
  const from = m.index + m[0].length
  let to = text.length
  for (const re of ends) {
    const rel = text.slice(from).search(re)
    if (rel !== -1) to = Math.min(to, from + rel)
  }
  return text.slice(from, to).replace(/\n{3,}/g, '\n\n').trim()
}

function buildOccurredAt(text: string): string | null {
  const dateM = text.match(DATE_RE)
  const timeM = text.match(TIME_RE)
  if (!dateM) return null
  const tzM = text.match(/GMT\s*([+-])\s*(\d{1,2})/i)
  const time = timeM ? `${timeM[1]} ${timeM[2] ?? ''}`.trim() : '12:00'
  const tz = tzM ? ` GMT${tzM[1]}${tzM[2].padStart(2, '0')}00` : ''
  const parsed = Date.parse(`${dateM[0]} ${time}${tz}`)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

export function parseCalendlyRecap(body: string | null | undefined, html?: string | null): CalendlyRecap {
  const text = (body ?? '').replace(/\r\n/g, '\n')
  const nonEmpty = text.split('\n').map((l) => l.trim()).filter(Boolean)

  const recapUrl = findRecapUrl(text) ?? (html ? findRecapUrl(html) : null)

  // Title = the line just before the date block (skip the subject echo / URLs).
  const dateIdx = nonEmpty.findIndex((l) => DATE_RE.test(l))
  let title = ''
  if (dateIdx > 0) {
    const cand = nonEmpty[dateIdx - 1]
    if (cand && cand.length <= 120 && !RECAP_SUBJECT_RE.test(cand) && !/^https?:\/\//i.test(cand)) {
      title = cand
    }
  }

  // Attendees = the comma-separated line after the time, before "View recording"/Summary.
  let attendeeNames: string[] = []
  const timeIdx = nonEmpty.findIndex((l) => TIME_RE.test(l))
  if (timeIdx !== -1) {
    for (let i = timeIdx + 1; i < nonEmpty.length; i++) {
      const l = nonEmpty[i]
      if (/^\s*Summary\s*$/i.test(l)) break
      if (/^https?:\/\//i.test(l) || /view (recording|recap)/i.test(l)) continue
      attendeeNames = l.split(',').map((s) => s.trim()).filter(Boolean)
      break
    }
  }

  const summary = sectionBetween(text, /^\s*Summary\s*$/im, [/^\s*Discussion\s*$/im])
  const discussion = sectionBetween(text, /^\s*Discussion\s*$/im, [
    /^\s*Ask Notetaker/im,
    /Was your meeting recap/i,
    /Portions of this email/i,
  ])

  return {
    title,
    occurredAt: buildOccurredAt(text),
    attendeeNames,
    recapUrl,
    summary,
    discussion,
  }
}

// ── Name-based attendee → customer matching ─────────────────────────────────
// Calendly recaps list attendee NAMES, not emails, so we can't match by email
// like the Bubbles webhook did. These pure helpers back a conservative,
// single-unambiguous-match lookup done in the IMAP sync.

export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Host/internal side of the call — never a customer. */
export function isHostAttendee(name: string): boolean {
  return /\bkapta\b|\bpedro\s+porto\b/i.test(name)
}

/** Conservative two-way substring match on normalized names (min 3 chars). */
export function nameMatches(attendee: string, candidate: string): boolean {
  const a = normalizeName(attendee)
  const c = normalizeName(candidate)
  if (!a || c.length < 3) return false
  return a.includes(c) || c.includes(a)
}
