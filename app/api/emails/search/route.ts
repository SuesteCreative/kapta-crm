import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// Server-side email search. Unlike the /emails page (which loads only the 200
// newest rows and filters client-side), this queries the WHOLE interactions
// table so any email — sender address, customer name, company, or subject —
// is findable regardless of age. Matches the EmailRow shape EmailsClient uses.

const RESULT_LIMIT = 100

const fullSelect = `
  id, customer_id, direction, subject, occurred_at, metadata, is_read,
  customers ( id, name, company, customer_identifiers ( type, value ) )
`
const fallbackSelect = `
  id, customer_id, direction, subject, occurred_at, metadata,
  customers ( id, name, company, customer_identifiers ( type, value ) )
`

// PostgREST .or() uses commas as separators and parens for grouping, so strip
// those from user input (plus the wildcard char) before interpolating.
function sanitize(q: string): string {
  return q.replace(/[,()*%]/g, ' ').trim()
}

export async function GET(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied

  const rawQ = new URL(req.url).searchParams.get('q') ?? ''
  const q = sanitize(rawQ)
  if (q.length < 2) {
    return NextResponse.json({ ok: true, emails: [] })
  }

  const supabase = createServiceClient()
  const pattern = `%${q}%`

  // 1. Resolve customers whose name/company OR email identifier matches.
  const [byNameRes, byEmailRes] = await Promise.all([
    supabase
      .from('customers')
      .select('id')
      .or(`name.ilike.${pattern},company.ilike.${pattern}`)
      .limit(500),
    supabase
      .from('customer_identifiers')
      .select('customer_id')
      .eq('type', 'email')
      .ilike('value', pattern)
      .limit(500),
  ])

  const customerIds = new Set<string>()
  for (const r of byNameRes.data ?? []) customerIds.add(r.id as string)
  for (const r of byEmailRes.data ?? []) customerIds.add(r.customer_id as string)

  // 2. Build the interactions OR filter: subject, matched_email metadata, and
  //    any interaction belonging to a matched customer.
  const star = `*${q}*`
  const orParts = [
    `subject.ilike.${star}`,
    `metadata->>matched_email.ilike.${star}`,
  ]
  if (customerIds.size > 0) {
    orParts.push(`customer_id.in.(${Array.from(customerIds).join(',')})`)
  }

  const runQuery = (select: string) =>
    supabase
      .from('interactions')
      .select(select)
      .eq('type', 'email')
      .or(orParts.join(','))
      .order('occurred_at', { ascending: false })
      .limit(RESULT_LIMIT)

  const primary = await runQuery(fullSelect)
  let rows = (primary.data ?? []) as unknown as Record<string, unknown>[]

  // Fallback when the is_read column isn't present (migration not applied).
  if (primary.error) {
    const fb = await runQuery(fallbackSelect)
    if (fb.error) {
      return NextResponse.json({ ok: false, error: fb.error.message }, { status: 500 })
    }
    rows = ((fb.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...r, is_read: true }))
  }

  return NextResponse.json({ ok: true, emails: rows })
}
