import { createServiceClient } from './supabase'

export async function getAiMemory(): Promise<string | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('templates')
    .select('body')
    .eq('name', '__ai_memory__')
    .maybeSingle()
  const body = data?.body?.trim()
  return body && body.length > 0 ? body : null
}

export function memorySystemBlock(memory: string | null): string {
  if (!memory) return ''
  return `\n\n---\n\nCONTEXTO DO NEGÓCIO (referência para todas as respostas):\n\n${memory}\n\n---\n`
}
