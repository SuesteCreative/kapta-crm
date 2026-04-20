import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAiMemory, memorySystemBlock } from '@/lib/ai-memory'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

type RefineRequest = {
  currentDraft: string
  instruction: string
  language?: 'pt-PT' | 'en'
}

export async function POST(req: NextRequest) {
  const { currentDraft, instruction, language = 'pt-PT' } = await req.json() as RefineRequest

  if (!currentDraft?.trim() || !instruction?.trim()) {
    return NextResponse.json({ ok: false, error: 'currentDraft e instruction são obrigatórios.' }, { status: 400 })
  }

  const langNote = language === 'en'
    ? 'The email is in British English. Keep the same language and tone.'
    : 'O email está em Português europeu. Mantém o mesmo idioma e tom.'

  const memory = await getAiMemory()

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: memory ? [{ type: 'text', text: memorySystemBlock(memory), cache_control: { type: 'ephemeral' } }] : undefined,
      messages: [{
        role: 'user',
        content: `You wrote the following email draft:
---
${currentDraft}
---
Apply this change: "${instruction}"

${langNote}

Return ONLY the revised email body — no explanation, no preamble, no JSON wrapper. Just the updated email text.`,
      }],
    })

    const refined = message.content[0].type === 'text' ? message.content[0].text.trim() : currentDraft
    return NextResponse.json({ ok: true, body: refined })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('refine-draft error:', msg)
    return NextResponse.json({ ok: false, error: `Erro: ${msg}` }, { status: 500 })
  }
}
