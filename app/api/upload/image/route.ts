import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { randomUUID } from 'crypto'

const BUCKET = 'interaction-images'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const supabase = createServiceClient()

    // Create bucket if it doesn't exist yet
    await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => null)

    const fileName = `${randomUUID()}.webp`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, buffer, { contentType: 'image/webp', upsert: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(fileName)

    return NextResponse.json({ url: publicUrl })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
