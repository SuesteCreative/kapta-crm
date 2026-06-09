import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const BUCKET = 'email-attachments'
const MAX_SIZE = 15 * 1024 * 1024 // 15 MB

// Lean upload for outbound email attachments + inline images.
// Uses the service-role client so it bypasses Storage RLS (the anon client
// cannot insert into the bucket — that's why client-side uploads failed).
// No AI analysis here on purpose: inline screenshots must be fast.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Nenhum ficheiro recebido.' }, { status: 400 })
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Ficheiro excede 15MB.' }, { status: 400 })
    }

    const supabase = createServiceClient()
    await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => null)

    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
    const path = `outbound/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
        upsert: false,
      })

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

    return NextResponse.json({
      name: file.name,
      url: publicUrl,
      mime: file.type || 'application/octet-stream',
      size: file.size,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
