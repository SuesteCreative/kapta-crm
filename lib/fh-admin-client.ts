// FareHarbor admin endpoint client.
// The admin site (kapta.pt/fareharbor-admin) exposes a JSON list of all form
// submissions. Used by /fareharbor to cross-match with email-flagged pending
// requests so a missed/delayed email doesn't hide a submission.

export interface FhAdminClient {
  id:            number
  nome:          string
  shortname:     string
  email:         string
  pais:          string
  sistema:       string
  autorizado:    0 | 1
  data_criacao:  string
}

interface FhAdminResponse {
  success: boolean
  count:   number
  clients: FhAdminClient[]
}

export async function fetchFhAdminClients(): Promise<FhAdminClient[]> {
  const baseUrl = process.env.FH_ADMIN_URL
  const token   = process.env.FH_ADMIN_TOKEN
  if (!baseUrl || !token) {
    throw new Error('FH_ADMIN_URL ou FH_ADMIN_TOKEN não configurados.')
  }

  const url = `${baseUrl}?token=${encodeURIComponent(token)}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`FH admin endpoint respondeu ${res.status}.`)
  }
  const json = (await res.json()) as FhAdminResponse
  if (!json.success || !Array.isArray(json.clients)) {
    throw new Error('Resposta inválida do FH admin endpoint.')
  }
  return json.clients
}
