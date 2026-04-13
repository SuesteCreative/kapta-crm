'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Building2, Globe, ArrowLeft, Pencil,
  Mail, MessageSquare, Video, Phone, FileText,
  Heart, Users, ExternalLink, Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EditCompanyDialog } from '@/components/edit-company-dialog'
import { AddInteractionDialog } from '@/components/add-interaction-dialog'
import {
  cn, STATUS_STYLES, STATUS_LABELS, HEALTH_COLORS, formatDateTime,
} from '@/lib/utils'
import type { Company, CustomerWithIdentifiers, Interaction } from '@/lib/database.types'

function cleanContent(raw: string): string {
  // Strip MIME headers (lines like "Content-Type: ...", boundary markers, etc.)
  return raw
    .split('\n')
    .filter((line) => {
      const l = line.trim()
      if (/^--[0-9a-fA-F_=]+/.test(l)) return false
      if (/^Content-(Type|Transfer-Encoding|Disposition):/i.test(l)) return false
      if (/^charset=/i.test(l)) return false
      if (/^boundary=/i.test(l)) return false
      return true
    })
    .join('\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const CHANNEL_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  email:    { icon: Mail,          color: '#3B82F6', bg: 'rgba(59,130,246,0.1)',  label: 'Email'    },
  whatsapp: { icon: MessageSquare, color: '#2DB975', bg: 'rgba(45,185,117,0.1)', label: 'WhatsApp' },
  meeting:  { icon: Video,         color: '#8B5CF6', bg: 'rgba(139,92,246,0.1)', label: 'Reunião'  },
  call:     { icon: Phone,         color: '#F97316', bg: 'rgba(249,115,22,0.1)', label: 'Chamada'  },
  note:     { icon: FileText,      color: '#9CA3AF', bg: 'rgba(156,163,175,0.1)',label: 'Nota'     },
}

interface Props {
  company: Company
  customers: CustomerWithIdentifiers[]
  interactions: Interaction[]
}

export function CompanyDetailClient({ company, customers, interactions }: Props) {
  const router = useRouter()
  const [showEdit, setShowEdit] = useState(false)
  const [addInteractionFor, setAddInteractionFor] = useState<string | null>(null) // customer_id
  const [showContactPicker, setShowContactPicker] = useState(false)

  // Build a map from customer_id → customer name for the timeline
  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c.name]))

  return (
    <div className="p-7 max-w-[1000px] mx-auto space-y-6 animate-fade-in">

      {/* Back */}
      <Link
        href="/companies"
        className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-70"
        style={{ color: 'var(--muted-foreground)' }}
      >
        <ArrowLeft className="h-3 w-3" /> Empresas
      </Link>

      {/* Header card */}
      <div className="rounded-xl p-6" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'rgba(91,91,214,0.1)' }}
            >
              <Building2 className="h-6 w-6" style={{ color: 'var(--primary)' }} />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
                {company.name}
              </h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {company.industry && (
                  <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    {company.industry}
                  </span>
                )}
                {company.domain && (
                  <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    <Globe className="h-3.5 w-3.5" /> {company.domain}
                  </span>
                )}
                {company.website && (
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--primary)' }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Website
                  </a>
                )}
              </div>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowEdit(true)}
            className="h-8 gap-1.5 rounded-lg text-[12.5px] font-medium shrink-0"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          >
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
        </div>

        {company.notes && (
          <div
            className="mt-4 p-3 rounded-lg text-sm"
            style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', borderLeft: '3px solid var(--border)' }}
          >
            {company.notes}
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="contacts">
        <TabsList
          className="rounded-lg p-1 h-auto gap-0.5"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          <TabsTrigger value="contacts" className="rounded-md text-[13px] px-4 py-1.5">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Contactos ({customers.length})
          </TabsTrigger>
          <TabsTrigger value="timeline" className="rounded-md text-[13px] px-4 py-1.5">
            Timeline ({interactions.length})
          </TabsTrigger>
        </TabsList>

        {/* CONTACTS */}
        <TabsContent value="contacts" className="mt-5 space-y-2">
          {customers.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Sem contactos. Edita um cliente e seleciona esta empresa.
              </p>
            </div>
          ) : (
            customers.map((c) => {
              const ss = STATUS_STYLES[c.status]
              return (
                <Link
                  key={c.id}
                  href={`/customers/${c.id}`}
                  className="flex items-center gap-4 rounded-xl p-4 transition-opacity hover:opacity-80"
                  style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)', display: 'flex' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm" style={{ color: 'var(--foreground)' }}>{c.name}</p>
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{ background: ss.bg, color: ss.text }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: ss.dot }} />
                        {STATUS_LABELS[c.status]}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {c.customer_identifiers.slice(0, 3).map((i) => (
                        <span key={i.id} className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                          {i.value}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className={cn('flex items-center gap-1 text-sm font-medium shrink-0', HEALTH_COLORS[c.health_score])}>
                    <Heart className="h-3.5 w-3.5 fill-current" /> {c.health_score}/5
                  </span>
                </Link>
              )
            })
          )}
        </TabsContent>

        {/* TIMELINE */}
        <TabsContent value="timeline" className="mt-5 space-y-3">
          {/* Add interaction button */}
          <div className="flex justify-end">
            {!showContactPicker ? (
              <Button
                onClick={() => customers.length === 1 ? setAddInteractionFor(customers[0].id) : setShowContactPicker(true)}
                size="sm"
                className="h-8 gap-1.5 rounded-lg text-[12.5px] font-medium"
                style={{ background: 'var(--primary)', color: '#fff' }}
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar interação
              </Button>
            ) : (
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <span className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Para qual contacto?</span>
                {customers.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setShowContactPicker(false); setAddInteractionFor(c.id) }}
                    className="h-8 px-3 rounded-lg text-[12px] font-medium transition-opacity hover:opacity-80"
                    style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)', border: '1px solid rgba(91,91,214,0.2)' }}
                  >
                    {c.name}
                  </button>
                ))}
                <button onClick={() => setShowContactPicker(false)} className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>Cancelar</button>
              </div>
            )}
          </div>

          {interactions.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Sem interações registadas para esta empresa.
              </p>
            </div>
          ) : (
            interactions.map((i) => {
              const ch = CHANNEL_CONFIG[i.type] ?? CHANNEL_CONFIG.note
              const Icon = ch.icon
              return (
                <div key={i.id} className="flex gap-3.5 animate-fade-in">
                  <div className="flex flex-col items-center">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: ch.bg }}
                    >
                      <Icon className="h-4 w-4" style={{ color: ch.color }} />
                    </div>
                  </div>
                  <div
                    className="flex-1 rounded-xl p-4 space-y-1.5"
                    style={{ background: 'var(--card)', boxShadow: 'var(--shadow-card)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: ch.color }}>
                            {ch.label}
                          </span>
                          {i.direction && (
                            <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                              {i.direction === 'inbound' ? '↓ recebido' : '↑ enviado'}
                            </span>
                          )}
                          {/* Contact name badge */}
                          {customerMap[i.customer_id] && (
                            <Link
                              href={`/customers/${i.customer_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[10px] rounded-full px-1.5 py-0.5 hover:opacity-70 transition-opacity"
                              style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)' }}
                            >
                              {customerMap[i.customer_id]}
                            </Link>
                          )}
                        </div>
                        {i.subject && (
                          <p className="font-medium text-[14px]" style={{ color: 'var(--foreground)' }}>{i.subject}</p>
                        )}
                      </div>
                      <span className="text-[11px] shrink-0" style={{ color: 'var(--muted-foreground)' }}>
                        {formatDateTime(i.occurred_at)}
                      </span>
                    </div>
                    {i.content && (
                      <p className="text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--muted-foreground)' }}>
                        {cleanContent(i.content).slice(0, 300)}
                      </p>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </TabsContent>
      </Tabs>

      <EditCompanyDialog
        open={showEdit}
        company={company}
        onClose={() => { setShowEdit(false); router.refresh() }}
      />

      {addInteractionFor && (
        <AddInteractionDialog
          open={true}
          customerId={addInteractionFor}
          onClose={() => { setAddInteractionFor(null); router.refresh() }}
        />
      )}
    </div>
  )
}
