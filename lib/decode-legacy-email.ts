/**
 * Decode legacy email content that was stored before mailparser was wired in:
 * - Strips MIME multipart envelope (--_000_xxx boundary + headers)
 * - Extracts text/plain section if present
 * - Decodes quoted-printable (=XX hex sequences) as UTF-8
 *
 * Pure string transform — works in both Node and browser.
 * Emails synced after the mailparser switch are already clean; this is a no-op for them.
 */

const BOUNDARY_START = /^--[\w\-.=+/]+\r?\n/
const BOUNDARY_ANYWHERE = /\n--[\w\-.=+/]+/
const PLAIN_SECTION = /Content-Type:\s*text\/plain[^\n]*(?:\r?\n(?:[A-Za-z-]+:[^\n]+))*\r?\n\r?\n([\s\S]*?)(?=\r?\n--[\w\-.=+/]+|$)/i
const QP_RUN = /(?:=[0-9A-Fa-f]{2})+/g
const QP_PAIR = /=([0-9A-Fa-f]{2})/g
const SOFT_BREAK = /=\r?\n/g

export function looksLikeLegacyEmail(raw: string | null | undefined): boolean {
  if (!raw) return false
  if (BOUNDARY_START.test(raw)) return true
  // UTF-8 byte pair common for PT accents: =C3=Axx
  if (/=C3=[89AB][0-9A-F]/i.test(raw)) return true
  return false
}

export function decodeLegacyEmailContent(raw: string | null | undefined): string | null {
  if (!raw) return raw ?? null

  let text = raw

  // Strip MIME envelope: extract first text/plain body section
  if (BOUNDARY_START.test(text) || BOUNDARY_ANYWHERE.test(text)) {
    const plainMatch = text.match(PLAIN_SECTION)
    if (plainMatch) {
      text = plainMatch[1]
    }
  }

  // Remove soft line breaks (trailing = on a wrapped line)
  text = text.replace(SOFT_BREAK, '')

  // Decode runs of =XX sequences as UTF-8 byte streams
  text = text.replace(QP_RUN, (match) => {
    const bytes: number[] = []
    let m: RegExpExecArray | null
    QP_PAIR.lastIndex = 0
    while ((m = QP_PAIR.exec(match)) !== null) {
      bytes.push(parseInt(m[1], 16))
    }
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes))
    } catch {
      return match
    }
  })

  return text.trim()
}
