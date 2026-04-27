import { supabase } from '@/lib/supabase'

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
