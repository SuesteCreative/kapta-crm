import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

type RefineRequest = {
  currentDraft: string
  instruction: string
  language?: 'pt-PT' | 'en'
}

const SYSTEM_PROMPT_PT = `Revise email draft for Pedro (Kapta, B2B account manager, PT).

Rules:
- Pedro instruction > default style. Always. Conflict: instruction wins.
- Apply literally. "shorter"=cut. "add X link"=insert literal X or URL Pedro mentioned. "more direct"=drop softeners. "menos formal"=drop formal openers.
- Keep greeting ("Olá X,") unless instruction changes it.
- No sign-off. Signature appended downstream. Do not add closing.
- European Portuguese (not Brazilian).
- No invented facts. Use "[verificar X]" when uncertain.

Output: revised body ONLY. No preamble, no quotes, no JSON, no "Here is".`

const SYSTEM_PROMPT_EN = `Revise email draft for Pedro (Kapta, B2B account manager).

Rules:
- Pedro instruction > default style. Always. Conflict: instruction wins.
- Apply literally. "shorter"=cut. "add X link"=insert literal X or URL Pedro mentioned. "more direct"=drop softeners.
- Keep greeting ("Hi X,") unless instruction changes it.
- No sign-off. Signature appended downstream. Do not add closing.
- Clear British English.
- No invented facts. Use "[check X]" when uncertain.

Output: revised body ONLY. No preamble, no quotes, no JSON, no "Here is".`

export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { currentDraft, instruction, language = 'pt-PT' } = await req.json() as RefineRequest

  if (!currentDraft?.trim() || !instruction?.trim()) {
    return NextResponse.json({ ok: false, error: 'currentDraft e instruction são obrigatórios.' }, { status: 400 })
  }

  const basePrompt = language === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_PT

  const userMessage = `<current_draft>
${currentDraft}
</current_draft>

<instruction>
${instruction.trim()}
</instruction>

Apply the instruction to the draft above. Return only the revised email body.`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      temperature: 0.3,
      system: [{ type: 'text', text: basePrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })

    let refined = message.content[0].type === 'text' ? message.content[0].text.trim() : currentDraft

    // Strip common AI preambles defensively
    refined = refined
      .replace(/^(here is|aqui está|aqui tem)[^\n]*\n+/i, '')
      .replace(/^```(?:[a-z]+)?\n([\s\S]*?)\n```$/m, '$1')
      .trim()

    return NextResponse.json({ ok: true, body: refined })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('refine-draft error:', msg)
    return NextResponse.json({ ok: false, error: `Erro: ${msg}` }, { status: 500 })
  }
}
