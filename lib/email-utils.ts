/**
 * Extract a "From: Name <email>" or "From: email" line from a forwarded/replied
 * email body. Returns the parsed sender if found, null otherwise.
 *
 * Shared between IMAP sync (real-time) and the customer-name backfill admin route.
 */
export function extractForwardedSender(body: string): { email: string; name: string } | null {
  const patterns = [
    /^[>\s]*From:\s+(?:"?([^"<\r\n]+?)"?\s+)?<([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/im,
    /^[>\s]*From:\s+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/im,
  ]
  for (const pattern of patterns) {
    const match = body.match(pattern)
    if (match) {
      const name  = match[1]?.trim() ?? ''
      const email = (match[2] ?? match[1])?.toLowerCase().trim()
      if (email?.includes('@')) return { email, name }
    }
  }
  return null
}

/** Heuristic: a name "looks human" if it has a space OR an uppercase letter. */
export function looksHumanName(name: string | null | undefined): boolean {
  if (!name) return false
  const trimmed = name.trim()
  if (!trimmed) return false
  return /\s/.test(trimmed) || /[A-Z]/.test(trimmed)
}
