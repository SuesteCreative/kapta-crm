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

const SYSTEM_PROMPT_PT = `You revise email drafts for Pedro (Portuguese B2B account manager, Kapta).

Your job: apply Pedro's instruction to the existing draft. Pedro's instruction wins over your default style preferences.

Rules:
- Apply the instruction literally. If Pedro says "shorter", make it shorter. If Pedro says "add a Calendly link", add the literal text "[Calendly link]" or the URL Pedro mentions. If Pedro says "more direct", drop softeners.
- Preserve the original greeting line ("Olá X,") unless Pedro tells you to change it.
- Do NOT add or change a sign-off / closing — there is none in the draft, that is correct, the signature is appended automatically by the send pipeline. If you find a closing already there, leave it; do not add one.
- Keep European Portuguese (not Brazilian).
- Never invent facts Pedro did not mention. Use "[verificar X]" when uncertain about a value.
- If Pedro's instruction conflicts with the existing draft, prioritise the instruction.

Output: ONLY the revised email body — no preamble, no quotes, no JSON, no "Here is the revised version" line. Just the new email text, ready to send.`

const SYSTEM_PROMPT_EN = `You revise email drafts for Pedro (Portuguese B2B account manager, Kapta).

Your job: apply Pedro's instruction to the existing draft. Pedro's instruction wins over your default style preferences.

Rules:
- Apply the instruction literally. If Pedro says "shorter", make it shorter. If Pedro says "add a Calendly link", insert the literal "[Calendly link]" or URL he mentions. If Pedro says "more direct", drop softeners.
- Preserve the original greeting line ("Hi X,") unless Pedro tells you to change it.
- Do NOT add or change a sign-off / closing — the signature is appended automatically by the send pipeline. If a closing is already present, leave it; do not add one.
- Keep clear, natural British English.
- Never invent facts Pedro did not mention. Use "[check X]" when uncertain about a value.
- If Pedro's instruction conflicts with the existing draft, prioritise the instruction.

Output: ONLY the revised email body — no preamble, no quotes, no JSON, no "Here is the revised version" line. Just the new email text, ready to send.`

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
