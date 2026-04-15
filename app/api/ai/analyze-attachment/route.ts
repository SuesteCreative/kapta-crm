import { NextRequest, NextResponse } from 'next/server'
import { analyzeAttachment } from '@/lib/analyze-attachment'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type AnalyzeRequest = {
  url: string
  mime: string
  name: string
  size: number
}

export async function POST(req: NextRequest) {
  const { url, mime, name, size } = await req.json() as AnalyzeRequest

  try {
    const fetchRes = await fetch(url)
    if (!fetchRes.ok) {
      return NextResponse.json({ summary: `${name} (could not fetch for analysis)` })
    }
    const buffer = Buffer.from(await fetchRes.arrayBuffer())
    const summary = await analyzeAttachment(buffer, { mime, name, size })
    return NextResponse.json({ summary })
  } catch (err) {
    console.error('analyze-attachment route error:', err)
    return NextResponse.json({ summary: name })
  }
}
