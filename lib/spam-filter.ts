/**
 * Spam/scam sender classifier — used at IMAP sync time to skip creating
 * customers/interactions for obvious junk (phishing, marketing notifications,
 * dropshipping product spam). Keep narrow on purpose: false positives mean
 * legitimate emails get dropped silently.
 */

const SPAM_NAME_PATTERNS: RegExp[] = [
  /\bchatgpt\b/i,
  /\bcomunicado oficial\b.*\bmeta\b/i,
  /\bmeta business (badge|manager|security)\b/i,
  /\bderila\b/i,
  /\bepi cooler\b/i,
  /\bcarplay\b/i,
  /\bcapcut(creator)?\b/i,
  /\bai-powered translation\b/i,
  /\blanguage translator\b/i,
  /\bdevice translator\b/i,
  /\bsmart tv usb stick\b/i,
  /\bberberine\b/i,
  /\bnuroclean\b/i,
  /\bgps air tag\b/i,
  /\bdriving glasses\b/i,
  /\bbaseempresarial\b/i,
  /^brevo$/i,
  // Single letter "S" followed by gibberish — generated scam names
  /^S [A-Z][a-z]{5,}$/,
]

const SPAM_EMAIL_PATTERNS: RegExp[] = [
  // Sketchy TLDs commonly abused for cold-spam
  /@[^@]*\.(top|click|bid|loan|win|stream|xyz)$/i,
  // Generated mail subdomains: mail.foo.bar, sendemail123.foo.com, etc.
  /@(mail|email|sendemail|send|notify)\d*\.[^@]+\.[^@]+$/i,
]

/** Cyrillic chars mixed in an otherwise-Latin display name = homoglyph attack. */
function hasCyrillicHomoglyph(text: string): boolean {
  return /[Ѐ-ӿ]/.test(text) && /[A-Za-z]/.test(text)
}

export function isSpamSender(
  displayName: string | null | undefined,
  email: string | null | undefined,
): boolean {
  const name = (displayName ?? '').trim()
  if (name) {
    if (hasCyrillicHomoglyph(name)) return true
    if (SPAM_NAME_PATTERNS.some((re) => re.test(name))) return true
  }
  const e = (email ?? '').trim()
  if (e && SPAM_EMAIL_PATTERNS.some((re) => re.test(e))) return true
  return false
}
