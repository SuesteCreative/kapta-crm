import type { Platform, InputPlatform, OutputPlatform } from './database.types'

export interface TicketHints {
  platform?: Platform
  input_platform?: InputPlatform
  output_platform?: OutputPlatform
  account_number?: string
  references?: string[]
}

const STRIPE_ID_RE = /\b(pi|ch|cus|sub|in|evt|re|py|seti|pm|prod|price|src|txn|cs|tok|card|ba)_[a-zA-Z0-9]{14,}\b/g
const EUPAGO_RE = /\b[A-Z]{2,4}-?\d{6,12}\b/g
const EASYPAY_RE = /\beasypay[\s:#-]+([A-Z0-9-]{6,32})\b/gi
const FAREHARBOR_RE = /\b(?:booking|reserva)[\s#:]+([A-Z0-9]{4,12})\b/gi

const INPUT_PATTERNS: Array<[InputPlatform, RegExp]> = [
  ['stripe',     /\bstripe\b/i],
  ['fareharbor', /\bfare ?harbor\b/i],
  ['shopify',    /\bshopify\b/i],
  ['easypay',    /\beasypay\b/i],
  ['eupago',     /\beupago\b/i],
]

const OUTPUT_PATTERNS: Array<[OutputPlatform, RegExp]> = [
  ['invoicexpress', /\binvoice ?xpress\b/i],
  ['moloni',        /\bmoloni\b/i],
  ['vendus',        /\bvendus\b/i],
  ['billin',        /\bbillin\b/i],
  ['holded',        /\bholded\b/i],
  ['sage',          /\bsage\b/i],
]

const PRODUCT_PATTERNS: Array<[Platform, RegExp]> = [
  ['konnector',  /\b(konnector|konex[ãa]o)\b/i],
  ['rioko',      /\brioko\b/i],
  ['stripe_app', /\bstripe ?app\b/i],
]

const ACCT_RE = /\b(?:account|acct|conta|cliente)[\s#:n.º-]*([A-Z0-9][A-Z0-9_-]{4,32})\b/i

function dedup(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)))
}

export function extractTicketHints(rawText: string | null | undefined): TicketHints {
  if (!rawText) return {}
  const text = rawText.replace(/\s+/g, ' ').trim()
  if (!text) return {}

  const hints: TicketHints = {}

  // References — Stripe IDs + payment refs
  const refs: string[] = []
  refs.push(...(text.match(STRIPE_ID_RE) ?? []))
  refs.push(...(text.match(EUPAGO_RE) ?? []))

  let m: RegExpExecArray | null
  EASYPAY_RE.lastIndex = 0
  while ((m = EASYPAY_RE.exec(text))) refs.push(m[1])
  FAREHARBOR_RE.lastIndex = 0
  while ((m = FAREHARBOR_RE.exec(text))) refs.push(`FH-${m[1]}`)

  const cleanRefs = dedup(refs)
  if (cleanRefs.length > 0) hints.references = cleanRefs

  // Input platform
  for (const [name, re] of INPUT_PATTERNS) {
    if (re.test(text)) { hints.input_platform = name; break }
  }
  // Output platform
  for (const [name, re] of OUTPUT_PATTERNS) {
    if (re.test(text)) { hints.output_platform = name; break }
  }
  // Product (explicit mention wins)
  for (const [name, re] of PRODUCT_PATTERNS) {
    if (re.test(text)) { hints.platform = name; break }
  }
  // Inference: input + output both detected → likely Konnector
  if (!hints.platform && hints.input_platform && hints.output_platform) {
    hints.platform = 'konnector'
  }

  // Account number — only if pattern explicit (avoid false positives on prose)
  const acct = text.match(ACCT_RE)
  if (acct) hints.account_number = acct[1]

  return hints
}
