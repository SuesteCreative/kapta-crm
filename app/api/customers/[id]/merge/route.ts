import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { mergeCustomers } from '@/lib/merge-customers'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: targetId } = await params
  const supabase = createServiceClient()

  let body: { source_id?: string } = {}
  try { body = await request.json() } catch { /* default */ }
  const { source_id } = body

  if (!source_id || source_id === targetId) {
    return NextResponse.json({ ok: false, error: 'source_id inválido' }, { status: 400 })
  }

  const result = await mergeCustomers(supabase, targetId, source_id)
  if (!result.ok) return NextResponse.json(result, { status: 500 })
  return NextResponse.json({ ok: true })
}
