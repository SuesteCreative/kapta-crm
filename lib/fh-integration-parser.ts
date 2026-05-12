import { countryFromInvoicingSystem, type FhCountry } from './database.types'

export interface FhIntegrationParsed {
  name?: string
  shortname?: string
  email?: string
  country?: FhCountry
  invoicingSystem?: string
  authorization?: boolean
}

const RE = {
  name:            /^[\s>]*(?:Name|Nome)\s*[:\-—]\s*(.+?)\s*$/im,
  // Labelled shortname (line-anchored with separator). Accept multi-word values
  // (some users type names instead of URL-safe slugs) — capture everything till EOL.
  shortname:       /^[\s>]*(?:FareHarbor\s+Shortname|FH\s+Shortname|Shortname)\s*[:\-—]\s*([^\r\n]+?)\s*$/im,
  // Same label but without a separator: "Shortname mallorcaseaparadise"
  shortnameNoSep:  /\b(?:FareHarbor\s+Shortname|FH\s+Shortname|Shortname)\s+([A-Za-z0-9_-]{3,})\b/i,
  // Inline URL: fareharbor.com/embeds/book/<shortname>/ or /api/external/v1/companies/<shortname>/
  shortnameUrl:    /fareharbor\.com\/(?:embeds\/book|api\/external\/v\d+\/companies)\/([A-Za-z0-9_-]+)\/?/i,
  email:           /^[\s>]*(?:Email|E[\- ]?mail)\s*[:\-—]\s*([^\s<>]+@[^\s<>]+)\s*$/im,
  country:         /^[\s>]*(?:Country|País|Pais)\s*[:\-—]\s*([A-Za-z]{2,})\s*$/im,
  invoicingSystem: /^[\s>]*(?:Invoicing\s+System|Sistema\s+de\s+factura(?:ção|cao)|Sistema\s+de\s+faturação)\s*[:\-—]\s*(.+?)\s*$/im,
  authorization:   /^[\s>]*(?:Authorization|Autoriza(?:ção|cao))\s*[:\-—]\s*(Yes|No|Sim|N[ãa]o|True|False)\s*$/im,
}

function normalizeCountry(raw: string | undefined): FhCountry | undefined {
  if (!raw) return undefined
  const v = raw.trim().toUpperCase()
  if (v === 'PT' || v === 'PORTUGAL') return 'PT'
  if (v === 'ES' || v === 'SPAIN' || v === 'ESPANHA' || v === 'ESPAÑA') return 'ES'
  return 'other'
}

function normalizeAuth(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined
  const v = raw.trim().toLowerCase()
  return v === 'yes' || v === 'sim' || v === 'true'
}

export function parseFhIntegrationEmail(body: string | null | undefined): FhIntegrationParsed {
  if (!body) return {}

  const name             = body.match(RE.name)?.[1]?.trim()
  // Try labelled (with sep) → labelled (no sep) → embedded URL. First hit wins.
  const shortname        = (body.match(RE.shortname)?.[1]
                          ?? body.match(RE.shortnameNoSep)?.[1]
                          ?? body.match(RE.shortnameUrl)?.[1])?.trim()
  const email            = body.match(RE.email)?.[1]?.toLowerCase().trim()
  const explicitCountry  = normalizeCountry(body.match(RE.country)?.[1])
  const invoicingSystem  = body.match(RE.invoicingSystem)?.[1]?.trim()
  const authorization    = normalizeAuth(body.match(RE.authorization)?.[1])

  // If country missing/unclear, derive from invoicing system (Moloni/IX/Vendus → PT, Holded/Billin/Sage → ES)
  const country = explicitCountry ?? countryFromInvoicingSystem(invoicingSystem) ?? undefined

  const out: FhIntegrationParsed = {}
  if (name)            out.name = name
  if (shortname)       out.shortname = shortname
  if (email)           out.email = email
  if (country)         out.country = country
  if (invoicingSystem) out.invoicingSystem = invoicingSystem
  if (authorization !== undefined) out.authorization = authorization
  return out
}

export function isFhIntegrationEmail(
  fromAddress: string | null | undefined,
  subject: string | null | undefined,
  body: string | null | undefined,
): boolean {
  if (!body) return false

  // Strong signal: body has both Shortname and Email fields (template-shaped).
  const hasShortname = RE.shortname.test(body)
  const hasEmail     = RE.email.test(body)
  if (hasShortname && hasEmail) return true

  // Weak fallback: sender + subject match (covers edge cases where shortname is missing).
  const fromMatches = !!fromAddress && /^site@kapta\.pt$/i.test(fromAddress.trim())
  const subjMatches = !!subject && /fare\s*harbor.*integration|integration.*fare\s*harbor/i.test(subject)
  return fromMatches && subjMatches
}
