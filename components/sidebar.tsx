'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Users, CalendarCheck, Ticket,
  FileText, RefreshCw, ChevronRight, Loader2, Building2, Settings, Mail, LogOut, ClipboardPaste, Plug,
} from 'lucide-react'
import { toast } from 'sonner'
import { GlobalPasteDialog } from '@/components/global-paste-dialog'

const nav = [
  { href: '/',            label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/customers',   label: 'Clientes',    icon: Users },
  { href: '/companies',   label: 'Empresas',    icon: Building2 },
  { href: '/emails',      label: 'Emails',      icon: Mail },
  { href: '/follow-ups',  label: 'Follow-ups',  icon: CalendarCheck },
  { href: '/tickets',     label: 'Tickets',     icon: Ticket },
  { href: '/fareharbor',  label: 'FareHarbor',  icon: Plug },
  { href: '/templates',   label: 'Templates',   icon: FileText },
  { href: '/settings',    label: 'Definições',  icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [syncing, setSyncing]   = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [fhPending, setFhPending] = useState<number>(0)

  // Pending FH count badge — fetch on mount + every 60s.
  // Previously refetched on every navigation, which hit a heavy endpoint
  // (pulls 1.5k interactions + external FH API) on every link click.
  useEffect(() => {
    if (pathname === '/login') return
    let cancelled = false
    const load = () => {
      fetch('/api/fareharbor/pending-count')
        .then((r) => r.ok ? r.json() : { count: 0 })
        .then((d) => { if (!cancelled) setFhPending(d.count ?? 0) })
        .catch(() => { /* silent */ })
    }
    load()
    const t = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  // Mount-only — pathname dep removed deliberately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Global keyboard shortcut: Cmd/Ctrl + Shift + V
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === 'v') {
        ev.preventDefault()
        setPasteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Auto-sync on app open + every 10 minutes while the tab stays open.
  // Previously fired on every pathname change: if the 10-min debounce had
  // elapsed, a navigation would trigger a 30-60s blocking IMAP sync followed
  // by router.refresh(), which felt like the app froze on every link click.
  useEffect(() => {
    if (pathname === '/login') return
    const INTERVAL_MS = 10 * 60 * 1000
    const maybeSync = () => {
      const lastSync = Number(localStorage.getItem('lastEmailSync') ?? 0)
      if (Date.now() - lastSync > INTERVAL_MS) syncEmail(true)
    }
    maybeSync()
    const t = setInterval(maybeSync, INTERVAL_MS)
    return () => clearInterval(t)
  // Mount-only — pathname dep removed deliberately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (pathname === '/login') return null

  async function syncEmail(silent = false) {
    // Fire-and-forget: dispatch to Inngest and return immediately. The actual
    // IMAP work runs in the background; <JobToaster /> shows the completion
    // toast via Supabase realtime when job_status is updated.
    setSyncing(true)
    try {
      const res = await fetch('/api/imap/sync-dispatch', { method: 'POST' })
      const data = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok || !data.ok) {
        throw new Error((data.error as string) ?? `HTTP ${res.status}`)
      }
      localStorage.setItem('lastEmailSync', String(Date.now()))
      if (!silent) {
        toast.info('A sincronizar email…', {
          description: 'O sync corre em segundo plano. Vais ser notificado quando terminar.',
          duration: 5000,
        })
      }
    } catch (e) {
      if (!silent) toast.error('Não consegui iniciar o sync', { description: String(e), duration: Infinity })
    } finally {
      // Visual "syncing" only while the dispatch request is in flight (ms).
      // Completion is signalled by the toast from <JobToaster />.
      setSyncing(false)
    }
  }

  return (
    <aside
      className="w-[220px] shrink-0 flex flex-col h-full"
      style={{
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--sidebar-border)',
      }}
    >
      {/* Logo */}
      <Link
        href="/"
        className="flex items-center gap-2.5 px-5 py-5 transition-opacity hover:opacity-80"
        style={{ borderBottom: '1px solid var(--sidebar-border)' }}
      >
        <img
          src="/SVG/mini-logo-white.svg"
          alt="Kapta"
          width={28}
          height={25}
          className="shrink-0"
        />
        <div>
          <p className="text-sm font-semibold leading-none" style={{ color: '#E8EAF0' }}>
            Kapta
          </p>
          <p className="text-[10px] leading-none mt-0.5" style={{ color: 'var(--sidebar-muted)' }}>
            CRM
          </p>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active =
            href === '/'
              ? pathname === '/'
              : pathname.startsWith(href)

          return (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-3 px-3 py-2 rounded-md text-[13.5px] font-medium transition-all duration-150 relative"
              style={{
                color: active ? '#E8EAF0' : 'var(--sidebar-muted)',
                background: active ? 'var(--sidebar-active-bg)' : 'transparent',
              }}
            >
              {/* Active indicator */}
              {active && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                  style={{ background: 'var(--sidebar-active-border)' }}
                />
              )}
              <Icon
                className="h-[15px] w-[15px] shrink-0 transition-colors"
                style={{ color: active ? 'var(--primary)' : undefined }}
                strokeWidth={active ? 2.5 : 2}
              />
              <span className="flex-1">{label}</span>
              {href === '/fareharbor' && fhPending > 0 && (
                <span
                  className="rounded-full text-[10px] font-semibold px-1.5 py-px tabular-nums"
                  style={{ background: 'rgba(229,72,77,0.18)', color: '#FF6B6B' }}
                  title={`${fhPending} por contactar`}
                >
                  {fhPending}
                </span>
              )}
              {active && (
                <ChevronRight
                  className="h-3 w-3 opacity-40"
                  style={{ color: 'var(--sidebar-text)' }}
                />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Bottom */}
      <div
        className="px-2.5 py-3 space-y-0.5"
        style={{ borderTop: '1px solid var(--sidebar-border)' }}
      >
        <button
          onClick={() => setPasteOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all duration-150 hover:opacity-80"
          style={{ color: 'var(--sidebar-muted)' }}
          title="Colar conversa (Ctrl+Shift+V)"
        >
          <ClipboardPaste className="h-[14px] w-[14px] shrink-0" />
          <span>Colar conversa</span>
        </button>

        <button
          onClick={() => syncEmail()}
          disabled={syncing}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all duration-150 disabled:opacity-50 hover:opacity-80"
          style={{ color: 'var(--sidebar-muted)' }}
        >
          {syncing
            ? <Loader2 className="h-[14px] w-[14px] shrink-0 animate-spin" />
            : <RefreshCw className="h-[14px] w-[14px] shrink-0" />}
          <span>{syncing ? 'A sincronizar…' : 'Sync email'}</span>
        </button>

        <div
          className="px-3 py-2.5 rounded-md mt-1 flex items-center justify-between"
          style={{ background: 'rgba(255,255,255,0.04)' }}
        >
          <div>
            <p className="text-[11px] font-medium" style={{ color: 'var(--sidebar-muted)' }}>
              Pedro
            </p>
            <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--sidebar-muted)' }}>
              pedro@kapta.pt
            </p>
          </div>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' })
              router.push('/login')
            }}
            title="Sair"
            className="p-1 rounded opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--sidebar-muted)' }}
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <GlobalPasteDialog open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </aside>
  )
}
