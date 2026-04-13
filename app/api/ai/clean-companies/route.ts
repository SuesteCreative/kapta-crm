import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Known personal email providers — contacts from these are people, not companies
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.pt', 'hotmail.co.uk',
  'outlook.com', 'outlook.pt', 'live.com', 'live.pt', 'msn.com',
  'yahoo.com', 'yahoo.pt', 'yahoo.co.uk', 'icloud.com', 'me.com',
  'sapo.pt', 'clix.pt', 'iol.pt', 'mail.pt', 'net.pt',
  'aol.com', 'protonmail.com', 'proton.me', 'tutanota.com',
])

// Domains that are clearly not real companies
const SPAM_DOMAINS = new Set([
  'instagram.com', 'mail.instagram.com', 'facebook.com', 'twitter.com',
  'linkedin.com', 'tiktok.com', 'youtube.com', 'google.com', 'apple.com',
  'amazon.com', 'microsoft.com', 'shopify.com', 'stripe.com',
])

const SYSTEM_PROMPT = `You are helping to clean up a CRM's company database for a Portuguese B2B business.

For each company record provided, analyze the email signature text (if any) and the domain to determine:
1. The correct/real company name (extracted from signature, not just the email domain)
2. Whether this is a legitimate B2B contact or should be removed

Return a JSON array where each item has:
- company_id: string
- action: "keep" | "rename" | "remove"
- suggested_name: string | null (only if action is "rename" — use the real company name from the signature)
- reason: string (brief explanation in Portuguese, max 8 words)

Guidelines:
- "remove": automated notifications, spam, social networks, newsletters, clearly not a client
- "rename": the current name is just the email domain but the signature reveals the real company name
- "keep": name is already correct

Return ONLY valid JSON array, no markdown, no explanation.`

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

type CleanResult = {
  company_id: string
  action: 'keep' | 'rename' | 'remove'
  suggested_name: string | null
  reason: string
}

export async function POST() {
  const supabase = createServiceClient()

  // Fetch all companies with their customers
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, domain, customers(id)')

  if (!companies || companies.length === 0) {
    return NextResponse.json({ ok: true, results: [], message: 'Sem empresas para analisar.' })
  }

  // For companies with customers, fetch one recent email to extract signature
  const companyIds = companies.map((c) => c.id)
  const customerIds = companies.flatMap((c) => (c.customers as { id: string }[]).map((cu) => cu.id)).slice(0, 100)

  const { data: emailSamples } = await supabase
    .from('interactions')
    .select('customer_id, content, customers(company_id)')
    .eq('type', 'email')
    .in('customer_id', customerIds)
    .order('occurred_at', { ascending: false })
    .limit(200)

  // Map: company_id → signature snippet
  const signatureByCompany = new Map<string, string>()
  if (emailSamples) {
    for (const e of emailSamples) {
      const raw = e.customers
      const customer = Array.isArray(raw) ? raw[0] : raw
      const companyId = (customer as { company_id?: string | null } | null)?.company_id
      if (!companyId || signatureByCompany.has(companyId)) continue
      if (!e.content) continue
      const text = stripHtml(e.content)
      // Take last 300 chars — signatures are usually at the bottom
      const snippet = text.slice(-300).trim()
      if (snippet.length > 20) signatureByCompany.set(companyId, snippet)
    }
  }

  // Pre-classify without AI: personal and spam domains → mark for removal
  const preRemove: CleanResult[] = []
  const needsAI: typeof companies = []

  for (const company of companies) {
    const domain = company.domain?.toLowerCase()
    if (domain && (PERSONAL_DOMAINS.has(domain) || SPAM_DOMAINS.has(domain))) {
      preRemove.push({
        company_id: company.id,
        action: 'remove',
        suggested_name: null,
        reason: 'Email pessoal ou serviço automático',
      })
    } else {
      needsAI.push(company)
    }
  }

  // Send to Claude only what needs analysis (cap at 40)
  const aiResults: CleanResult[] = []
  const batch = needsAI.slice(0, 40)

  if (batch.length > 0) {
    const batchText = batch.map((c) => JSON.stringify({
      company_id: c.id,
      current_name: c.name,
      domain: c.domain ?? null,
      signature_snippet: signatureByCompany.get(c.id) ?? null,
    })).join('\n')

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

    let message
    try {
      message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Analyze these companies:\n\n${batchText}` }],
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
      const parsed = JSON.parse(match[0]) as CleanResult[]
      aiResults.push(...parsed)
    } catch {
      return NextResponse.json({ ok: false, error: 'Claude returned invalid JSON' }, { status: 500 })
    }
  }

  const allResults = [...preRemove, ...aiResults]

  // Apply: rename and remove (keep = no action)
  const toRemove = allResults.filter((r) => r.action === 'remove').map((r) => r.company_id)
  const toRename = allResults.filter((r) => r.action === 'rename' && r.suggested_name)

  let removed = 0
  let renamed = 0

  if (toRemove.length > 0) {
    await supabase.from('companies').delete().in('id', toRemove)
    removed = toRemove.length
  }

  for (const r of toRename) {
    await supabase.from('companies').update({ name: r.suggested_name }).eq('id', r.company_id)
    renamed++
  }

  return NextResponse.json({
    ok: true,
    removed,
    renamed,
    kept: allResults.filter((r) => r.action === 'keep').length,
    total: companies.length,
    results: allResults,
  })
}
