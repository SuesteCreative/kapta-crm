import { supabase } from '@/lib/supabase'

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr',
  'outlook.com', 'outlook.pt', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.uk',
  'yahoo.es', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'gmx.com', 'gmx.de',
  'protonmail.com', 'proton.me', 'sapo.pt', 'clix.pt', 'iol.pt', 'netcabo.pt',
  'mail.com', 'zoho.com', 'pm.me',
])

const TLD_STRIP_RE = /\.(com|net|org|io|co|pt|eu|uk|us|br|de|fr|es|it|nl|be|ch|at|au|nz|ca|app|dev|ai|tech|digital|agency|studio|group|cloud)\b.*/i

function titleCase(s: string): string {
  return s.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function domainToCompanyName(domain: string): string {
  const base = domain.replace(TLD_STRIP_RE, '').replace(/\.[a-z]{2,4}$/, '')
  return base.split(/[-_.]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export interface DerivedCompany {
  name: string
  domain: string | null
}

export function deriveCompanyFromSender(email: string, displayName: string): DerivedCompany | null {
  const parts = email.toLowerCase().split('@')
  if (parts.length !== 2) return null
  const local  = parts[0].replace(/\+.*$/, '')
  const domain = parts[1]

  if (!PERSONAL_DOMAINS.has(domain)) {
    return { name: domainToCompanyName(domain), domain }
  }

  const dn = displayName?.trim() ?? ''
  if (dn && /\s/.test(dn) && !dn.includes('@')) {
    const words = dn.split(/\s+/).filter(Boolean)
    if (words.length >= 2) return { name: titleCase(dn), domain: null }
  }

  const tokens = local.split(/[._\-]/).filter(Boolean)
  if (tokens.length >= 2) {
    return { name: tokens.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(' '), domain: null }
  }

  return null
}

export function isPersonalDomain(email: string): boolean {
  const domain = email.toLowerCase().split('@')[1]
  return !domain || PERSONAL_DOMAINS.has(domain)
}

export function shortnameToCompanyGuess(shortname: string): string {
  const cleaned = shortname.replace(/[-_]+/g, ' ').trim()
  return titleCase(cleaned) || shortname
}

export interface CompanyRow {
  id: string
  name: string
  domain: string | null
}

export async function ensureCompany(input: { name: string; domain: string | null }): Promise<CompanyRow | null> {
  const name   = input.name.trim()
  const domain = input.domain?.toLowerCase().trim() || null
  if (!name) return null

  if (domain) {
    const { data: byDomain } = await supabase
      .from('companies')
      .select('id, name, domain')
      .eq('domain', domain)
      .maybeSingle()
    if (byDomain) return byDomain as CompanyRow
  }

  const { data: byName } = await supabase
    .from('companies')
    .select('id, name, domain')
    .ilike('name', name)
    .maybeSingle()
  if (byName) return byName as CompanyRow

  const { data: created, error } = await supabase
    .from('companies')
    .insert({ name, domain })
    .select('id, name, domain')
    .single()
  if (error || !created) return null
  return created as CompanyRow
}

export interface FindCustomerResult {
  customer_id: string
  name: string
  company: string | null
}

export async function findCustomerByEmail(email: string): Promise<FindCustomerResult | null> {
  const value = email.toLowerCase().trim()
  if (!value) return null

  const { data } = await supabase
    .from('customer_identifiers')
    .select('customer_id, customers(id, name, company)')
    .eq('type', 'email')
    .eq('value', value)
    .maybeSingle()

  if (!data?.customer_id) return null
  const raw = (data as unknown as { customers?: { name: string; company: string | null } | { name: string; company: string | null }[] | null }).customers
  const customer = Array.isArray(raw) ? raw[0] ?? null : raw ?? null
  return {
    customer_id: data.customer_id as string,
    name: customer?.name ?? '',
    company: customer?.company ?? null,
  }
}

export interface ResolveCustomerInput {
  email: string
  contactName: string
  companyOverride?: { name: string; domain?: string | null } | null
}

export interface ResolveCustomerResult {
  customer_id: string
  created_customer: boolean
  company: CompanyRow | null
}

/**
 * Resolve or create a customer + company for a FareHarbor integration request.
 * 1. If an identifier exists for this email → return that customer_id (no writes).
 * 2. Otherwise derive a company (from override, or domain, or display name),
 *    ensureCompany → ensureCustomer → ensureIdentifier.
 */
export async function resolveOrCreateCustomerForFh(input: ResolveCustomerInput): Promise<ResolveCustomerResult> {
  const email = input.email.toLowerCase().trim()
  if (!email || !email.includes('@')) throw new Error('Email inválido.')

  const existing = await findCustomerByEmail(email)
  if (existing) {
    return { customer_id: existing.customer_id, created_customer: false, company: null }
  }

  let companyInput: { name: string; domain: string | null } | null = null
  if (input.companyOverride && input.companyOverride.name.trim()) {
    companyInput = {
      name: input.companyOverride.name.trim(),
      domain: input.companyOverride.domain?.toLowerCase().trim() || null,
    }
  } else {
    const derived = deriveCompanyFromSender(email, input.contactName)
    if (derived) companyInput = derived
  }

  const company = companyInput ? await ensureCompany(companyInput) : null

  const { data: newCustomer, error: custErr } = await supabase
    .from('customers')
    .insert({
      name: input.contactName.trim() || email.split('@')[0],
      status: 'onboarding',
      health_score: 3,
      company:    company?.name ?? null,
      company_id: company?.id   ?? null,
    })
    .select('id')
    .single()
  if (custErr || !newCustomer) {
    throw new Error(custErr?.message || 'Erro ao criar cliente.')
  }
  const customerId = newCustomer.id as string

  await supabase.from('customer_identifiers').insert({
    customer_id: customerId,
    type: 'email',
    value: email,
    is_primary: true,
  })

  return { customer_id: customerId, created_customer: true, company }
}
