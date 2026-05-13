import { countryFromInvoicingSystem, normalizeFhCountry, type FhCountry } from './database.types'

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
  // Allow multi-word country names ("Costa Rica", "United Arab Emirates", "Belgique / België")
  country:         /^[\s>]*(?:Country|País|Pais)\s*[:\-—]\s*([^\r\n]+?)\s*$/im,
  invoicingSystem: /^[\s>]*(?:Invoicing\s+System|Sistema\s+de\s+factura(?:ção|cao)|Sistema\s+de\s+faturação)\s*[:\-—]\s*(.+?)\s*$/im,
  authorization:   /^[\s>]*(?:Authorization|Autoriza(?:ção|cao))\s*[:\-—]\s*(Yes|No|Sim|N[ãa]o|True|False)\s*$/im,
}

function normalizeCountry(raw: string | undefined): FhCountry | undefined {
  return normalizeFhCountry(raw) ?? undefined
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
  // Form submissions always come from site@kapta.pt. Reply emails (e.g. partner
  // replying to a confirmation) often QUOTE the original template in the body,
  // which used to trigger the strong signal — gating on sender removes that
  // false positive class entirely.
  const fromMatches = !!fromAddress && /^site@kapta\.pt$/i.test(fromAddress.trim())
  if (!fromMatches) return false

  // Either body template OR subject is enough once we know it's from site@.
  if (body && RE.shortname.test(body) && RE.email.test(body)) return true
  if (subject && /fare\s*harbor.*integration|integration.*fare\s*harbor/i.test(subject)) return true
  return false
}

// ============================================================
// Confirmation-email handling
// "Olá <Name>, A sua integração com a Kapta está concluída.
//  Pode agora aceder à sua conta e prosseguir para: https://rioko.pt"
// Sent FROM notificacoes@kapta.pt (external system, not the CRM) to the partner.
// ============================================================

export interface FhConfirmationParsed {
  name?: string
  email?: string
}

const CONFIRM_RE = {
  // "Olá NAME," — the name line that opens the message.
  greeting: /^[\s>]*Ol[áa]\s+([^,\r\n]+?)\s*,/im,
  // The completion sentence (with or without accents).
  body: /a sua integra[çc][ãa]o com a kapta est[áa] conclu[íi]da/i,
  rioko: /rioko\.pt/i,
}

export function isFhConfirmationEmail(
  fromAddress: string | null | undefined,
  body: string | null | undefined,
): boolean {
  if (!body) return false
  const fromMatches = !!fromAddress && /^notificacoes@kapta\.pt$/i.test(fromAddress.trim())
  if (!fromMatches) return false
  return CONFIRM_RE.body.test(body) && CONFIRM_RE.rioko.test(body)
}

export function parseFhConfirmationEmail(
  body: string | null | undefined,
  toEmail: string | null | undefined,
): FhConfirmationParsed {
  const out: FhConfirmationParsed = {}
  if (body) {
    const name = body.match(CONFIRM_RE.greeting)?.[1]?.trim()
    if (name) out.name = name
  }
  if (toEmail) {
    const e = toEmail.trim().toLowerCase()
    if (e && !/^notificacoes@kapta\.pt$/i.test(e) && !/@kapta\.pt$/i.test(e)) {
      out.email = e
    }
  }
  return out
}
