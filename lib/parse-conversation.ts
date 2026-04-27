export interface ParsedMessage {
  sender: string
  content: string
  occurred_at: string // ISO string
}

// Format A: [DD/MM/YYYY, HH:mm] or [DD/MM/YYYY, HH:mm:ss]  (Android/most exports)
const WA_LINE_A = /^\[(\d{2}\/\d{2}\/\d{4}),\s(\d{2}:\d{2}(?::\d{2})?)\]\s([^:]+):\s(.+)$/
const WA_TS_A   = /^\[\d{2}\/\d{2}\/\d{4},\s\d{2}:\d{2}/

// Format B: [HH:mm, DD/MM/YYYY]  (iOS Portuguese locale)
const WA_LINE_B = /^\[(\d{2}:\d{2}(?::\d{2})?),\s(\d{2}\/\d{2}\/\d{4})\]\s([^:]+):\s(.+)$/
const WA_TS_B   = /^\[\d{2}:\d{2},\s\d{2}\/\d{2}\/\d{4}\]/

function parseLine(trimmed: string): { date: string; time: string; sender: string; content: string } | null {
  const a = WA_LINE_A.exec(trimmed)
  if (a) return { date: a[1], time: a[2], sender: a[3], content: a[4] }
  const b = WA_LINE_B.exec(trimmed)
  if (b) return { date: b[2], time: b[1], sender: b[3], content: b[4] }
  return null
}

function isTimestampLine(trimmed: string): boolean {
  return WA_TS_A.test(trimmed) || WA_TS_B.test(trimmed)
}

function toISO(date: string, time: string): string {
  const [day, month, year] = date.split('/')
  const t = time.length === 5 ? time + ':00' : time
  return new Date(`${year}-${month}-${day}T${t}`).toISOString()
}

export function isWhatsAppFormat(raw: string): boolean {
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0)
  if (!firstLine) return false
  return parseLine(firstLine.trim()) !== null
}

export function parseWhatsAppChat(raw: string): ParsedMessage[] {
  const messages: ParsedMessage[] = []
  const lines = raw.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const parsed = parseLine(trimmed)
    if (parsed) {
      messages.push({
        sender: parsed.sender.trim(),
        content: parsed.content.trim(),
        occurred_at: toISO(parsed.date, parsed.time),
      })
    } else if (messages.length > 0 && !isTimestampLine(trimmed)) {
      // Continuation of previous message
      messages[messages.length - 1].content += '\n' + trimmed
    }
    // System messages (timestamp line but no sender:content) — skip
  }

  return messages
}

export function parsePlainConversation(raw: string): ParsedMessage[] {
  return [{
    sender: 'unknown',
    content: raw.trim(),
    occurred_at: new Date().toISOString(),
  }]
}

/**
 * Extract a phone number from a WhatsApp export header or first messages.
 * Handles "+351 912 345 678", "+351912345678", "00351912345678", "912345678".
 * Returns digits only (no spaces) with leading + preserved if present.
 * Returns null when nothing plausible is found.
 */
export function extractPhoneFromHeader(raw: string): string | null {
  if (!raw) return null
  const head = raw.slice(0, 2000)

  // Prefer explicit international format with +
  const intl = head.match(/\+\d[\d\s.\-()]{7,16}\d/)
  if (intl) return normalizePhone(intl[0])

  // Then "00" international prefix
  const zeroPrefixed = head.match(/\b00\d[\d\s.\-()]{7,16}\d/)
  if (zeroPrefixed) {
    const norm = normalizePhone(zeroPrefixed[0])
    return norm.replace(/^00/, '+')
  }

  // Continuous 9-15 digit sequence (national number)
  const national = head.match(/\b\d{9,15}\b/)
  if (national) return normalizePhone(national[0])

  return null
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim()
  const digits = trimmed.replace(/[^\d+]/g, '')
  // Avoid stray + in the middle (shouldn't happen, but be safe)
  if (digits.startsWith('+')) {
    return '+' + digits.slice(1).replace(/\+/g, '')
  }
  return digits
}
