export type CustomerStatus = 'onboarding' | 'active' | 'at-risk' | 'troubleshooting' | 'churned'
export type InteractionType = 'email' | 'whatsapp' | 'meeting' | 'call' | 'note'
export type Direction = 'inbound' | 'outbound'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type FollowUpStatus = 'open' | 'done' | 'snoozed'
export type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed'
export type IdentifierType = 'email' | 'phone' | 'whatsapp'

export interface Customer {
  id: string
  name: string
  company: string | null
  status: CustomerStatus
  plan: string | null
  health_score: number
  notes: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface CustomerIdentifier {
  id: string
  customer_id: string
  type: IdentifierType
  value: string
  is_primary: boolean
  created_at: string
}

export interface Interaction {
  id: string
  customer_id: string
  type: InteractionType
  direction: Direction | null
  subject: string | null
  content: string | null
  source_id: string | null
  bubbles_url: string | null
  bubbles_title: string | null
  metadata: Record<string, unknown> | null
  occurred_at: string
  created_at: string
}

export interface FollowUp {
  id: string
  customer_id: string
  title: string
  description: string | null
  due_date: string | null
  priority: Priority
  status: FollowUpStatus
  snoozed_until: string | null
  created_at: string
  completed_at: string | null
}

export interface Ticket {
  id: string
  customer_id: string
  title: string
  description: string | null
  steps_to_reproduce: string | null
  expected_behavior: string | null
  actual_behavior: string | null
  priority: Priority
  status: TicketStatus
  tags: string[]
  created_at: string
  updated_at: string
}

export interface Template {
  id: string
  name: string
  type: 'email' | 'whatsapp' | 'note' | null
  subject: string | null
  body: string
  created_at: string
}

// Enriched types (with joins)
export interface CustomerWithIdentifiers extends Customer {
  customer_identifiers: CustomerIdentifier[]
}

export interface CustomerWithStats extends Customer {
  customer_identifiers: CustomerIdentifier[]
  open_follow_ups: number
  open_tickets: number
  last_interaction: string | null
}

export type Database = {
  public: {
    Tables: {
      customers: { Row: Customer; Insert: Omit<Customer, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Omit<Customer, 'id'>> }
      customer_identifiers: { Row: CustomerIdentifier; Insert: Omit<CustomerIdentifier, 'id' | 'created_at'>; Update: Partial<Omit<CustomerIdentifier, 'id'>> }
      interactions: { Row: Interaction; Insert: Omit<Interaction, 'id' | 'created_at'>; Update: Partial<Omit<Interaction, 'id'>> }
      follow_ups: { Row: FollowUp; Insert: Omit<FollowUp, 'id' | 'created_at'>; Update: Partial<Omit<FollowUp, 'id'>> }
      tickets: { Row: Ticket; Insert: Omit<Ticket, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Omit<Ticket, 'id'>> }
      templates: { Row: Template; Insert: Omit<Template, 'id' | 'created_at'>; Update: Partial<Omit<Template, 'id'>> }
    }
  }
}
