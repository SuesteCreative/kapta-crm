import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { analyzeAttachment } from '@/lib/analyze-attachment'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const BUCKET = 'email-attachments'
const MAX_SIZE = 20 * 1024 * 1024 // 20 MB

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large (max 20 MB)' }, { status: 400 })
    }

    const supabase = createServiceClient()
    await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => null)

    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
    const fileName = `manual/${randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(fileName)

    const ai_summary = await analyzeAttachment(buffer, {
      mime: file.type || 'application/octet-stream',
      name: file.name,
      size: file.size,
    })

    return NextResponse.json({
      url: publicUrl,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      ai_summary,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
