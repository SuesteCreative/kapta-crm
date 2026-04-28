import { supabase } from '@/lib/supabase'
import type { Platform, InputPlatform, OutputPlatform } from '@/lib/database.types'

export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface CreateFollowUpInput {
  customer_id: string
  title: string
  description?: string | null
  due_date?: string | null
  priority?: Priority
}

export interface CreateTicketInput {
  customer_id: string
  title: string
  description?: string | null
  actual_behavior?: string | null
  priority?: Priority
  platform?: Platform | null
  input_platform?: InputPlatform | null
  output_platform?: OutputPlatform | null
  account_number?: string | null
  references_list?: string[]
  source_interaction_id?: string | null
}

export async function createFollowUp(input: CreateFollowUpInput): Promise<void> {
  const { error } = await supabase.from('follow_ups').insert({
    customer_id: input.customer_id,
    title: input.title.trim(),
    description: input.description ?? null,
    due_date: input.due_date ?? null,
    priority: input.priority ?? 'medium',
  })
  if (error) throw error
}

export async function createTicket(input: CreateTicketInput): Promise<void> {
  const { error } = await supabase.from('tickets').insert({
    customer_id: input.customer_id,
    title: input.title.trim(),
    description: input.description ?? null,
    actual_behavior: input.actual_behavior ?? null,
    priority: input.priority ?? 'medium',
    platform: input.platform ?? null,
    input_platform: input.input_platform ?? null,
    output_platform: input.output_platform ?? null,
    account_number: input.account_number ?? null,
    references_list: input.references_list ?? [],
    source_interaction_id: input.source_interaction_id ?? null,
  })
  if (error) throw error
}

export interface CreateNoteInput {
  customer_id: string
  title: string
  body?: string | null
}

export async function createNote(input: CreateNoteInput): Promise<void> {
  const { error } = await supabase.from('interactions').insert({
    customer_id: input.customer_id,
    type: 'note',
    direction: null,
    subject: input.title.trim(),
    content: input.body ?? null,
  })
  if (error) throw error
}
