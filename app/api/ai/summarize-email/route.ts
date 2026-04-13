import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SYSTEM_PROMPT = `Summarize business email in European Portuguese. Extract 3-5 bullet points.

Rules: action verb or keyword first; max 12 words/bullet; skip greetings/sign-offs/boilerplate; focus on problems, requests, deadlines, key info.
Return JSON array of strings only. No markdown.
Example: ["Problema com fatura de março","Pede reembolso de 250€","Prazo: sexta-feira"]`

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST(req: Request) {
  const { content, subject } = await req.json() as { content: string; subject?: string }

  if (!content || content.trim().length < 20) {
    return NextResponse.json({ ok: false, error: 'Conteúdo insuficiente.' }, { status: 400 })
  }

  const cleaned = stripHtml(content).slice(0, 2000)

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: subject
        ? `Assunto: ${subject}\n\n${cleaned}`
        : cleaned,
    }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = rawText.match(/\[[\s\S]*\]/)
  const raw = match ? match[0] : '[]'

  try {
    const bullets: string[] = JSON.parse(raw)
    return NextResponse.json({ ok: true, bullets })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao processar resposta.' }, { status: 500 })
  }
}
