import { createServiceClient } from './supabase'

export async function getAiMemory(): Promise<string | null> {
  const supabase = createServiceClient()
  const [{ data: memRow }, { data: calRow }] = await Promise.all([
    supabase.from('templates').select('body').eq('name', '__ai_memory__').maybeSingle(),
    supabase.from('templates').select('body').eq('name', '__calendly_url__').maybeSingle(),
  ])

  const body = memRow?.body?.trim() ?? ''
  const calendly = calRow?.body?.trim() ?? ''

  const parts: string[] = []
  if (body.length > 0) parts.push(body)
  if (calendly.length > 0) {
    parts.push(`## Calendly\nUsa este link sempre que precisares de marcar reunião / propor disponibilidade: ${calendly}\nNUNCA escrevas placeholders como "[link Calendly]" — usa este URL diretamente.`)
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}

export function memorySystemBlock(memory: string | null): string {
  if (!memory) return ''
  return `\n\n---\n\nCONTEXTO DO NEGÓCIO (referência para todas as respostas):\n\n${memory}\n\n---\n`
}
