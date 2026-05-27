// Platform detection for incoming emails.
// Matches sender, subject, and body against known SaaS / invoicing / payment
// platforms so the email list can show pills at a glance.
//
// Detection is render-cheap (a handful of regexes per email) and runs at
// IMAP sync time; results are persisted in metadata.detected_platforms so
// the email list doesn't need to re-scan bodies on every render.

export type PlatformCategory = 'invoicing' | 'payments' | 'commerce'

export interface PlatformDef {
  key:      string
  label:    string
  category: PlatformCategory
  /** Matched against `${from} ${subject} ${body}`. Word-boundaried to avoid generic-word false positives. */
  regex:    RegExp
}

// Word-boundary helper. Some platform names are common English words (e.g. "sage"),
// so each pattern requires a word boundary on both sides.
function wb(name: string): RegExp {
  return new RegExp(`\\b${name}\\b`, 'i')
}

export const PLATFORMS: PlatformDef[] = [
  // ── Invoicing (PT) ────────────────────────────────────────────────────
  { key: 'moloni',         label: 'Moloni',         category: 'invoicing', regex: wb('moloni') },
  { key: 'igest',          label: 'IGEST',          category: 'invoicing', regex: wb('igest') },
  { key: 'invoicexpress',  label: 'InvoiceXpress',  category: 'invoicing', regex: /\binvoice[\s-]?xpress\b/i },
  { key: 'vendus',         label: 'Vendus',         category: 'invoicing', regex: wb('vendus') },

  // ── Invoicing (ES) ────────────────────────────────────────────────────
  { key: 'holded',         label: 'Holded',         category: 'invoicing', regex: wb('holded') },
  { key: 'billin',         label: 'Billin',         category: 'invoicing', regex: wb('billin') },
  { key: 'sage',           label: 'Sage',           category: 'invoicing', regex: /\bsage(\.com|\.es|\.pt|\s+(invoices?|business|contabili|conta))\b/i },

  // ── Payments ──────────────────────────────────────────────────────────
  { key: 'stripe',         label: 'Stripe',         category: 'payments',  regex: wb('stripe') },
  { key: 'paypal',         label: 'PayPal',         category: 'payments',  regex: /\bpay[\s-]?pal\b/i },
  { key: 'eupago',         label: 'eupago',         category: 'payments',  regex: /\beu[\s-]?pago\b/i },
  { key: 'easypay',        label: 'easypay',        category: 'payments',  regex: /\beasy[\s-]?pay\b/i },

  // ── Commerce / Marketplaces ───────────────────────────────────────────
  { key: 'shopify',        label: 'Shopify',        category: 'commerce',  regex: wb('shopify') },
  // Amazon is very common in unrelated contexts (book titles, news). Require
  // a corporate/transactional context: Amazon.<tld>, AWS, Seller Central, etc.
  { key: 'amazon',         label: 'Amazon',         category: 'commerce',  regex: /\bamazon(\.[a-z]{2,3}|\s+(seller|web\s+services|pay|business|marketplace))\b/i },
]

const PLATFORM_BY_KEY = Object.fromEntries(PLATFORMS.map((p) => [p.key, p])) as Record<string, PlatformDef>

/**
 * Detects platforms mentioned in an email. Searches the combined haystack of
 * `from`, `subject`, and `body` against each platform's regex. Returns an
 * array of platform keys (stable order — same as PLATFORMS declaration).
 */
export function detectPlatforms(
  subject:  string | null | undefined,
  body:     string | null | undefined,
  from:     string | null | undefined,
): string[] {
  const haystack = `${from ?? ''} ${subject ?? ''} ${body ?? ''}`
  const found: string[] = []
  for (const p of PLATFORMS) {
    if (p.regex.test(haystack)) found.push(p.key)
  }
  return found
}

export function getPlatform(key: string): PlatformDef | null {
  return PLATFORM_BY_KEY[key] ?? null
}

// Pill styling per category. Matches FH pill palette in components/emails-client.tsx.
export const PLATFORM_STYLES: Record<PlatformCategory, { bg: string; text: string }> = {
  invoicing: { bg: 'rgba(91,91,214,0.12)',  text: 'var(--primary)'      },
  payments:  { bg: 'rgba(45,185,117,0.10)', text: 'var(--status-active)' },
  commerce:  { bg: 'rgba(245,158,11,0.15)', text: '#B45309'              },
}
