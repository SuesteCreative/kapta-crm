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

type AttachmentMeta = { name: string; ai_summary?: string }

export async function POST(req: Request) {
  const { content, subject, attachments } = await req.json() as {
    content: string
    subject?: string
    attachments?: AttachmentMeta[]
  }

  if (!content || content.trim().length < 20) {
    return NextResponse.json({ ok: false, error: 'Conteúdo insuficiente.' }, { status: 400 })
  }

  let cleaned = stripHtml(content).slice(0, 2000)
  if (attachments && attachments.length > 0) {
    const attLine = attachments.map((a) => `${a.name}: ${a.ai_summary ?? a.name}`).join(' | ')
    cleaned += `\n[Attachments: ${attLine}]`
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let message
  try {
    message = await client.messages.create({
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Claude API error:', msg)
    return NextResponse.json({ ok: false, error: `Claude error: ${msg}` }, { status: 500 })
  }

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = rawText.match(/\[[\s\S]*\]/)
  if (!match) {
    console.error('Claude non-JSON response:', rawText.slice(0, 200))
    return NextResponse.json({ ok: false, error: 'Claude returned unexpected format' }, { status: 500 })
  }

  try {
    const bullets: string[] = JSON.parse(match[0])
    return NextResponse.json({ ok: true, bullets })
  } catch {
    return NextResponse.json({ ok: false, error: 'Erro ao processar resposta.' }, { status: 500 })
  }
}
