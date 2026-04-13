'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Plus, Search, Globe, Users, MailSearch, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NewCompanyDialog } from '@/components/new-company-dialog'
import { toast } from 'sonner'

interface CompanyRow {
  id: string
  name: string
  domain: string | null
  industry: string | null
  website: string | null
  notes: string | null
  created_at: string
  updated_at: string
  customers: { id: string }[]
}

export function CompaniesClient({ companies }: { companies: CompanyRow[] }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [importing, setImporting] = useState(false)
  const [cleaning, setCleaning] = useState(false)

  async function handleCleanWithAI() {
    setCleaning(true)
    try {
      const res = await fetch('/api/ai/clean-companies', { method: 'POST' })
      const text = await res.text()
      let json: { ok: boolean; removed?: number; renamed?: number; kept?: number; total?: number; error?: string }
      try { json = JSON.parse(text) } catch { throw new Error('Servidor sem resposta.') }
      if (!json.ok) throw new Error(json.error ?? 'Erro desconhecido')
      toast.success(`${json.removed} removidas · ${json.renamed} renomeadas · ${json.kept} mantidas`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao organizar empresas.')
    } finally {
      setCleaning(false)
    }
  }

  async function handleEmailImport() {
    setImporting(true)
    try {
      const res = await fetch('/api/email/import-contacts')
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Erro desconhecido')
      toast.success(json.message)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao importar contactos.')
    } finally {
      setImporting(false)
    }
  }

  const filtered = companies.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.name.toLowerCase().includes(q) ||
      c.domain?.toLowerCase().includes(q) ||
      c.industry?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="p-7 max-w-[1100px] mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Empresas</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {companies.length} empresa{companies.length !== 1 ? 's' : ''} registada{companies.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleCleanWithAI}
            disabled={cleaning}
            className="h-9 gap-1.5 rounded-lg text-[13px] font-medium"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            {cleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {cleaning ? 'A organizar…' : 'Organizar com IA'}
          </Button>
          <Button
            variant="outline"
            onClick={handleEmailImport}
            disabled={importing}
            className="h-9 gap-1.5 rounded-lg text-[13px] font-medium"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            {importing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <MailSearch className="h-3.5 w-3.5" />}
            {importing ? 'A importar…' : 'Importar do email'}
          </Button>
          <Button
            onClick={() => setShowNew(true)}
            className="h-9 gap-1.5 rounded-lg text-[13px] font-medium"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            <Plus className="h-3.5 w-3.5" /> Nova empresa
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
          style={{ color: 'var(--muted-foreground)' }}
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar nome, domínio, indústria…"
          className="pl-9"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
          }}
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div
          className="rounded-xl p-12 text-center"
          style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
        >
          <Building2 className="h-8 w-8 mx-auto mb-3" style={{ color: 'var(--muted-foreground)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
            {search ? 'Nenhuma empresa encontrada' : 'Sem empresas ainda'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
            {search ? 'Tenta outra pesquisa.' : 'Cria a primeira empresa para começar.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((company) => (
            <div
              key={company.id}
              onClick={() => router.push(`/companies/${company.id}`)}
              className="flex items-center gap-4 rounded-xl p-4 cursor-pointer transition-opacity hover:opacity-80"
              style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
            >
              {/* Icon */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(91,91,214,0.1)' }}
              >
                <Building2 className="h-5 w-5" style={{ color: 'var(--primary)' }} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>
                  {company.name}
                </p>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {company.industry && (
                    <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      {company.industry}
                    </span>
                  )}
                  {company.domain && (
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      <Globe className="h-3 w-3" /> {company.domain}
                    </span>
                  )}
                </div>
              </div>

              {/* Contact count */}
              <div className="flex items-center gap-1.5 shrink-0">
                <Users className="h-3.5 w-3.5" style={{ color: 'var(--muted-foreground)' }} />
                <span
                  className="text-[12px] font-medium rounded-full px-2 py-0.5"
                  style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                >
                  {company.customers.length} contacto{company.customers.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <NewCompanyDialog open={showNew} onClose={() => { setShowNew(false); router.refresh() }} />
    </div>
  )
}
