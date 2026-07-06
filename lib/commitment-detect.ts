import Anthropic from '@anthropic-ai/sdk'

/**
 * Single-email commitment detection.
 *
 * When Pedro sends an outbound email promising to get back to a client
 * ("entro em contacto mais tarde", "vou dando feedback", "envio na segunda"…)
 * we auto-create a follow-up. This detects that promise in ONE email and
 * extracts the topic + a due date when one is clearly stated.
 *
 * A cheap regex prefilter (`hasCommitmentLanguage`) runs first so the AI is
 * only called on emails that actually contain follow-up language.
 */

export interface CommitmentDetection {
  isCommitment: boolean
  /** Short PT phrase describing what Pedro committed to (the follow-up topic). */
  topic: string
  /** YYYY-MM-DD when a concrete date was stated; null when vague/absent. */
  dueDateISO: string | null
}

/** Default deadline when no concrete date is stated: 7 days out. */
export const DEFAULT_DUE_DAYS = 7

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function plusDaysISO(days: number, from: Date = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Resolve the follow-up due date: use the concrete date the AI extracted,
 * otherwise default to +7 days (covers vague promises like "fim da semana",
 * "para a semana", "ao fim do dia", "mais tarde").
 */
export function resolveDueDate(dueDateISO: string | null): string {
  if (dueDateISO && /^\d{4}-\d{2}-\d{2}$/.test(dueDateISO)) return dueDateISO
  return plusDaysISO(DEFAULT_DUE_DAYS)
}

// Broad, intentionally over-inclusive — false positives are fine (the AI
// confirms), but we want to skip the AI call entirely on plain emails.
const COMMITMENT_LANGUAGE = new RegExp(
  [
    'entr\\w*\\s+em\\s+contacto',
    'volto\\s+a\\s+(falar|contactar|si)',
    'volto\\s+ao\\s+assunto',
    'dou[\\s-]*(lhe|te)?\\s*not[ií]cias',
    '(dar|dando|dou|dou-lhe)\\s+feedback',
    'feedback',
    'fico\\s+de',
    'ficamos\\s+de',
    'ficei?\\s+de',
    'envi\\w+',
    'mando\\s',
    'assim\\s+que',
    'logo\\s+que',
    '[àa]\\s+medida\\s+que',
    'mais\\s+tarde',
    'brevemente',
    'em\\s+breve',
    'esta\\s+semana',
    'pr[oó]xima\\s+semana',
    'para\\s+a\\s+semana',
    'ao\\s+fim\\s+do\\s+dia',
    'fim\\s+da\\s+semana',
    'amanh[ãa]',
    '(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(-feira)?',
    'no\\s+dia\\s+\\d',
    'confirmo[\\s-]*(lhe|te)?',
    'aviso[\\s-]*(o|lhe|te)?',
    'falo\\s+consigo',
    'retomo',
    // English fallbacks
    'i[\'’]?ll\\s+(send|check|call|follow\\s*up|get\\s+back|let\\s+you\\s+know)',
    'will\\s+get\\s+back',
    'follow\\s*up',
  ].join('|'),
  'i',
)

/** Cheap prefilter — true if the text plausibly contains a follow-up promise. */
export function hasCommitmentLanguage(text: string): boolean {
  return COMMITMENT_LANGUAGE.test(text)
}

const SYSTEM_PROMPT = `És um assistente do Pedro (Kapta, gestor de conta B2B, PT).

Recebes UM email que o Pedro acabou de ENVIAR a um cliente. Decide se, nesse email, o Pedro se compromete a voltar a contactar o cliente / fazer algo depois (ex: "entro em contacto mais tarde", "vou dando feedback", "envio a proposta", "confirmo na segunda", "fico de verificar").

Cumprimentos vagos ou fecho de conversa ("qualquer coisa diga", "obrigado") NÃO contam.

Devolve SÓ um objeto JSON (sem markdown, sem texto extra):
{
  "isCommitment": true|false,
  "topic": "frase curta em PT (≤8 palavras) do que o Pedro ficou de fazer/assunto, ex: 'mapeamento dos itens do Stripe'",
  "dueDate": "YYYY-MM-DD" | null
}

Regra da data (HOJE é {{TODAY}}):
- Preenche "dueDate" SÓ se o email indicar uma data concreta e resolúvel: "amanhã", "segunda-feira", "dia 15", "20/07", "daqui a 3 dias".
- Vago ("fim da semana", "para a semana", "em breve", "mais tarde", "ao fim do dia", "assim que puder") → "dueDate": null.
- Se não houver compromisso, "isCommitment": false e "dueDate": null.`

function parseDetection(raw: string): CommitmentDetection {
  const fallback: CommitmentDetection = { isCommitment: false, topic: '', dueDateISO: null }
  if (!raw) return fallback
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return fallback
  try {
    const obj = JSON.parse(match[0]) as { isCommitment?: unknown; topic?: unknown; dueDate?: unknown }
    const due = typeof obj.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.dueDate) ? obj.dueDate : null
    return {
      isCommitment: obj.isCommitment === true,
      topic: typeof obj.topic === 'string' ? obj.topic.trim().slice(0, 120) : '',
      dueDateISO: due,
    }
  } catch {
    return fallback
  }
}

/**
 * Detect a follow-up commitment in a single outbound email.
 * Never throws — on any failure returns { isCommitment: false }.
 * Callers should run `hasCommitmentLanguage` first to avoid the AI cost.
 */
export async function detectCommitment(subject: string, body: string): Promise<CommitmentDetection> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { isCommitment: false, topic: '', dueDateISO: null }

  const client = new Anthropic({ apiKey })
  const userMessage = `Assunto: ${subject || '(sem assunto)'}\n\nCorpo:\n${body.slice(0, 3000)}`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      temperature: 0,
      system: [{ type: 'text', text: SYSTEM_PROMPT.replace('{{TODAY}}', todayISO()) }],
      messages: [{ role: 'user', content: userMessage }],
    })
    const text = message.content[0]?.type === 'text' ? message.content[0].text : ''
    return parseDetection(text)
  } catch (err) {
    console.error('detectCommitment error:', err instanceof Error ? err.message : String(err))
    return { isCommitment: false, topic: '', dueDateISO: null }
  }
}
