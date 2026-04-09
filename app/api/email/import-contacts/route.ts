import { NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Common personal/provider domains — don't create companies for these
const SKIP_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.com.br',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'live.co.uk',
  'icloud.com', 'me.com', 'mac.com', 'msn.com', 'aol.com',
  'protonmail.com', 'proton.me', 'tutanota.com',
  'sapo.pt', 'iol.pt', 'netcabo.pt', 'clix.pt',
])

// Skip automated senders
const SKIP_PREFIXES = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'notifications', 'notification', 'mailer-daemon', 'postmaster',
  'bounce', 'unsubscribe', 'newsletter', 'marketing', 'automatico',
  'automacao', 'robot', 'bot@',
]

/**
 * Turn a domain into a human-readable company name.
 * "meet-frank.com" → "Meet Frank"
 * "acme.co.uk"    → "Acme"
 */
function domainToCompanyName(domain: string): string {
  // Remove known TLDs (handles .co.uk, .com.br, single TLDs)
  let base = domain
    .replace(/\.(com|net|org|io|co|pt|eu|uk|us|br|de|fr|es|it|nl|be|ch|at|au|nz|ca|app|dev|ai|tech|digital|agency|studio|group|cloud)\b.*/i, '')
    .replace(/\.[a-z]{2,4}$/, '') // fallback: strip last segment

  return base
    .split(/[-_.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Best-effort display name from an address object.
 */
function extractName(addr: { name?: string; address?: string }): string {
  if (addr.name?.trim()) return addr.name.trim()
  const local = addr.address?.split('@')[0] ?? 'Desconhecido'
  return local
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export async function GET() {
  const supabase = createServiceClient()

  const ourEmail = (process.env.IMAP_USER ?? '').toLowerCase()
  const ourDomain = ourEmail.split('@')[1] ?? ''

  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    tls: { rejectUnauthorized: false },
    logger: false,
  })

  // email → { name, domain }
  const found = new Map<string, { name: string; domain: string }>()

  try {
    await client.connect()

    for (const path of ['INBOX', 'Sent']) {
      let lock
      try { lock = await client.getMailboxLock(path) } catch { continue }
      try {
        const uids: number[] = []
        for await (const msg of client.fetch('1:*', { uid: true })) uids.push(msg.uid)

        const toProcess = uids.reverse().slice(0, 500)
        if (!toProcess.length) continue

        for await (const msg of client.fetch(toProcess, { uid: true, envelope: true }, { uid: true })) {
          const addrs = [
            ...(msg.envelope?.from ?? []),
            ...(msg.envelope?.to ?? []),
            ...(msg.envelope?.cc ?? []),
          ]
          for (const addr of addrs) {
            if (!addr.address) continue
            const email = addr.address.toLowerCase().trim()
            if (email === ourEmail) continue
            if (found.has(email)) continue

            const [local, domain] = email.split('@')
            if (!domain || !local) continue
            if (domain === ourDomain) continue
            if (SKIP_DOMAINS.has(domain)) continue
            if (SKIP_PREFIXES.some((p) => local.startsWith(p))) continue

            found.set(email, { name: extractName(addr), domain })
          }
        }
      } finally {
        lock.release()
      }
    }

    await client.logout()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }

  if (found.size === 0) {
    return NextResponse.json({ ok: true, imported_customers: 0, imported_companies: 0, skipped_existing: 0, message: 'Nenhum contacto novo encontrado.' })
  }

  // ── Load existing identifiers in one query ──
  const allEmails = [...found.keys()]
  const { data: existingIds } = await supabase
    .from('customer_identifiers')
    .select('value')
    .in('value', allEmails)
  const alreadyKnown = new Set((existingIds ?? []).map((r) => r.value))

  const newContacts = [...found.entries()].filter(([email]) => !alreadyKnown.has(email))
  const skippedExisting = found.size - newContacts.length

  if (newContacts.length === 0) {
    return NextResponse.json({ ok: true, imported_customers: 0, imported_companies: 0, skipped_existing: skippedExisting, message: `Todos os ${skippedExisting} contactos já existem no CRM.` })
  }

  // ── Load existing companies by domain in one query ──
  const domainsNeeded = [...new Set(newContacts.map(([, v]) => v.domain))]
  const { data: existingCompanies } = await supabase
    .from('companies')
    .select('id, name, domain')
    .in('domain', domainsNeeded)

  const companyByDomain = new Map<string, { id: string; name: string }>()
  for (const c of existingCompanies ?? []) {
    if (c.domain) companyByDomain.set(c.domain, { id: c.id, name: c.name })
  }

  // ── Create missing companies ──
  const missingDomains = domainsNeeded.filter((d) => !companyByDomain.has(d))
  let importedCompanies = 0

  if (missingDomains.length) {
    const toInsert = missingDomains.map((d) => ({
      name: domainToCompanyName(d),
      domain: d,
      updated_at: new Date().toISOString(),
    }))
    const { data: created } = await supabase
      .from('companies')
      .insert(toInsert)
      .select('id, name, domain')
    for (const c of created ?? []) {
      if (c.domain) companyByDomain.set(c.domain, { id: c.id, name: c.name })
    }
    importedCompanies = created?.length ?? 0
  }

  // ── Create customers + identifiers ──
  let importedCustomers = 0

  for (const [email, { name, domain }] of newContacts) {
    const company = companyByDomain.get(domain) ?? null

    const { data: customer } = await supabase
      .from('customers')
      .insert({
        name,
        company: company?.name ?? null,
        company_id: company?.id ?? null,
        status: 'active',
      })
      .select('id')
      .single()

    if (!customer) continue

    await supabase.from('customer_identifiers').insert({
      customer_id: customer.id,
      type: 'email',
      value: email,
      is_primary: true,
    })

    importedCustomers++
  }

  return NextResponse.json({
    ok: true,
    imported_customers: importedCustomers,
    imported_companies: importedCompanies,
    skipped_existing: skippedExisting,
    message: `${importedCustomers} clientes importados, ${importedCompanies} empresas criadas, ${skippedExisting} já existiam.`,
  })
}
