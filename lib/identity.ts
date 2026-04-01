/**
 * Customer identity resolution
 * Matches any email or phone to a customer_id across all channels.
 */
import { supabase } from './supabase'

export function normaliseIdentifier(value: string): string {
  return value.toLowerCase().trim()
}

export function extractPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '')
}

/**
 * Resolve a customer_id from any identifier (email or phone).
 * Returns null if no match found.
 */
export async function resolveCustomer(value: string): Promise<string | null> {
  const normalised = normaliseIdentifier(value)
  const { data } = await supabase
    .from('customer_identifiers')
    .select('customer_id')
    .eq('value', normalised)
    .limit(1)
    .single()
  return data?.customer_id ?? null
}

/**
 * Link a new identifier to an existing customer.
 */
export async function linkIdentifier(
  customerId: string,
  type: 'email' | 'phone' | 'whatsapp',
  value: string,
  isPrimary = false
) {
  const normalised = normaliseIdentifier(value)
  const { error } = await supabase.from('customer_identifiers').upsert(
    { customer_id: customerId, type, value: normalised, is_primary: isPrimary },
    { onConflict: 'type,value', ignoreDuplicates: true }
  )
  return error
}

/**
 * Get all identifiers for a customer.
 */
export async function getIdentifiers(customerId: string) {
  const { data } = await supabase
    .from('customer_identifiers')
    .select('*')
    .eq('customer_id', customerId)
    .order('is_primary', { ascending: false })
  return data ?? []
}
