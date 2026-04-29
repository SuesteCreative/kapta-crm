export type CustomerStatus = 'onboarding' | 'active' | 'at-risk' | 'troubleshooting' | 'churned'
export type InteractionType = 'email' | 'whatsapp' | 'meeting' | 'call' | 'note' | 'slack'
export type Direction = 'inbound' | 'outbound'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type FollowUpStatus = 'open' | 'done' | 'snoozed'
export type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed'
export type IdentifierType = 'email' | 'phone' | 'whatsapp' | 'slack_channel'

export const PLATFORMS = ['rioko', 'stripe_app', 'konnector'] as const
export const INPUT_PLATFORMS = ['stripe', 'fareharbor', 'shopify', 'easypay', 'eupago', 'outro'] as const
export const OUTPUT_PLATFORMS = ['invoicexpress', 'moloni', 'vendus', 'billin', 'holded', 'sage', 'outro'] as const
export type Platform = typeof PLATFORMS[number]
export type InputPlatform = typeof INPUT_PLATFORMS[number]
export type OutputPlatform = typeof OUTPUT_PLATFORMS[number]

// Unified flat list (used by company integrations UI — single dropdown)
export const ALL_PLATFORMS = [
  'rioko', 'stripe_app', 'konnector',
  'stripe', 'fareharbor', 'shopify', 'easypay', 'eupago',
  'invoicexpress', 'moloni', 'vendus', 'billin', 'holded', 'sage',
  'outro',
] as const
export const ALL_PLATFORM_LABELS: Record<string, string> = {
  rioko: 'Rioko',
  stripe_app: 'Stripe App',
  konnector: 'Konnector',
  stripe: 'Stripe',
  fareharbor: 'FareHarbor',
  shopify: 'Shopify',
  easypay: 'Easypay',
  eupago: 'Eupago',
  invoicexpress: 'InvoiceXpress',
  moloni: 'Moloni',
  vendus: 'Vendus',
  billin: 'Billin',
  holded: 'Holded',
  sage: 'Sage',
  outro: 'Outro',
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  rioko: 'Rioko',
  stripe_app: 'Stripe App',
  konnector: 'Konnector',
}
export const INPUT_PLATFORM_LABELS: Record<InputPlatform, string> = {
  stripe: 'Stripe',
  fareharbor: 'FareHarbor',
  shopify: 'Shopify',
  easypay: 'Easypay',
  eupago: 'Eupago',
  outro: 'Outro',
}
export const OUTPUT_PLATFORM_LABELS: Record<OutputPlatform, string> = {
  invoicexpress: 'InvoiceXpress',
  moloni: 'Moloni',
  vendus: 'Vendus',
  billin: 'Billin',
  holded: 'Holded',
  sage: 'Sage',
  outro: 'Outro',
}

export interface Company {
  id: string
  name: string
  domain: string | null
  website: string | null
  industry: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CompanyWithContacts extends Company {
  customers: CustomerWithIdentifiers[]
}

export interface CompanyIntegration {
  id: string
  company_id: string
  platform: string             // any value from ALL_PLATFORMS (no DB check after simplify migration)
  input_platform: InputPlatform | null   // legacy — unused by simplified UI
  output_platform: OutputPlatform | null // legacy — unused by simplified UI
  account_number: string | null
  references_list: string[]
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  name: string
  company: string | null
  company_id: string | null
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
  platform: Platform | null
  input_platform: InputPlatform | null
  output_platform: OutputPlatform | null
  account_number: string | null
  references_list: string[]
  source_interaction_id: string | null
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
      companies: { Row: Company; Insert: Omit<Company, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Omit<Company, 'id'>> }
      customers: { Row: Customer; Insert: Omit<Customer, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Omit<Customer, 'id'>> }
      customer_identifiers: { Row: CustomerIdentifier; Insert: Omit<CustomerIdentifier, 'id' | 'created_at'>; Update: Partial<Omit<CustomerIdentifier, 'id'>> }
      interactions: { Row: Interaction; Insert: Omit<Interaction, 'id' | 'created_at'>; Update: Partial<Omit<Interaction, 'id'>> }
      follow_ups: { Row: FollowUp; Insert: Omit<FollowUp, 'id' | 'created_at'>; Update: Partial<Omit<FollowUp, 'id'>> }
      tickets: { Row: Ticket; Insert: Omit<Ticket, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Omit<Ticket, 'id'>> }
      templates: { Row: Template; Insert: Omit<Template, 'id' | 'created_at'>; Update: Partial<Omit<Template, 'id'>> }
      company_integrations: { Row: CompanyIntegration; Insert: Omit<CompanyIntegration, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Omit<CompanyIntegration, 'id'>> }
    }
  }
}
