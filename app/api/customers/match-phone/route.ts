import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

interface RequestBody {
  phone?: string
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '')
}

export async function POST(req: Request) {
  const denied = requireAuth(req)
  if (denied) return denied
  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const phone = (body.phone ?? '').trim()
  if (!phone) {
    return NextResponse.json({ ok: false, error: 'phone required' }, { status: 400 })
  }

  const digits = digitsOnly(phone)
  if (digits.length < 6) {
    return NextResponse.json({ ok: true, match: null })
  }

  // Match strategy: compare last 9 digits of stored values to last 9 of incoming.
  // Handles "+351 912 345 678" vs "00351912345678" vs "912345678" all matching.
  const tail = digits.slice(-9)

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('customer_identifiers')
    .select('value, customer_id, customers(id, name, company)')
    .in('type', ['phone', 'whatsapp'])

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  type Row = {
    value: string
    customer_id: string
    customers: { id: string; name: string; company: string | null } | { id: string; name: string; company: string | null }[] | null
  }

  const candidates = (data ?? []) as Row[]
  const hit = candidates.find((row) => digitsOnly(row.value).slice(-9) === tail)

  if (!hit) {
    return NextResponse.json({ ok: true, match: null })
  }

  const customer = Array.isArray(hit.customers) ? hit.customers[0] : hit.customers
  if (!customer) {
    return NextResponse.json({ ok: true, match: null })
  }

  return NextResponse.json({
    ok: true,
    match: {
      customer_id: customer.id,
      name: customer.name,
      company: customer.company,
    },
  })
}
