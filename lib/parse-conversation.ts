export interface ParsedMessage {
  sender: string
  content: string
  occurred_at: string // ISO string
}

// Matches: [25/03/2025, 09:15:30] Sender Name: message
// Also handles without seconds: [25/03/2025, 09:15] Sender Name: message
const WA_LINE = /^\[(\d{2}\/\d{2}\/\d{4}),\s(\d{2}:\d{2}(?::\d{2})?)\]\s([^:]+):\s(.+)$/

// Matches the timestamp prefix only (for detecting continuation lines vs system msgs)
const WA_TIMESTAMP = /^\[(\d{2}\/\d{2}\/\d{4}),\s\d{2}:\d{2}/

export function isWhatsAppFormat(raw: string): boolean {
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0)
  return firstLine ? WA_LINE.test(firstLine.trim()) : false
}

export function parseWhatsAppChat(raw: string): ParsedMessage[] {
  const messages: ParsedMessage[] = []
  const lines = raw.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const match = WA_LINE.exec(trimmed)
    if (match) {
      const [, date, time, sender, content] = match
      // Parse dd/MM/yyyy HH:mm or HH:mm:ss
      const [day, month, year] = date.split('/')
      const isoDate = `${year}-${month}-${day}T${time.length === 5 ? time + ':00' : time}`
      messages.push({
        sender: sender.trim(),
        content: content.trim(),
        occurred_at: new Date(isoDate).toISOString(),
      })
    } else if (messages.length > 0 && !WA_TIMESTAMP.test(trimmed)) {
      // Continuation line (multi-line message) — append to previous
      messages[messages.length - 1].content += '\n' + trimmed
    }
    // Lines that match WA_TIMESTAMP but not WA_LINE are system messages — skip
  }

  return messages
}

export function parsePlainConversation(raw: string): ParsedMessage[] {
  // Fallback: treat entire text as a single interaction
  return [
    {
      sender: 'unknown',
      content: raw.trim(),
      occurred_at: new Date().toISOString(),
    },
  ]
}
