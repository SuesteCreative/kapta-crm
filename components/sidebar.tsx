'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard, Users, CalendarCheck, Ticket,
  FileText, RefreshCw, ChevronRight, Loader2,
} from 'lucide-react'

const nav = [
  { href: '/',            label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/customers',   label: 'Clientes',    icon: Users },
  { href: '/follow-ups',  label: 'Follow-ups',  icon: CalendarCheck },
  { href: '/tickets',     label: 'Tickets',     icon: Ticket },
  { href: '/templates',   label: 'Templates',   icon: FileText },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)

  async function syncEmail() {
    setSyncing(true)
    try {
      await fetch('/api/imap/sync')
      router.refresh()
    } finally {
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
      <div
        className="flex items-center gap-2.5 px-5 py-5"
        style={{ borderBottom: '1px solid var(--sidebar-border)' }}
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ background: 'var(--primary)' }}
        >
          K
        </div>
        <div>
          <p className="text-sm font-semibold leading-none" style={{ color: '#E8EAF0' }}>
            Kapta
          </p>
          <p className="text-[10px] leading-none mt-0.5" style={{ color: 'var(--sidebar-muted)' }}>
            CRM
          </p>
        </div>
      </div>

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
          onClick={syncEmail}
          disabled={syncing}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all duration-150 disabled:opacity-50"
          style={{ color: 'var(--sidebar-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--sidebar-text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--sidebar-muted)')}
        >
          {syncing
            ? <Loader2 className="h-[14px] w-[14px] shrink-0 animate-spin" />
            : <RefreshCw className="h-[14px] w-[14px] shrink-0" />}
          <span>{syncing ? 'A sincronizar…' : 'Sync email'}</span>
        </button>

        <div
          className="px-3 py-2.5 rounded-md mt-1"
          style={{ background: 'rgba(255,255,255,0.04)' }}
        >
          <p className="text-[11px] font-medium" style={{ color: 'var(--sidebar-muted)' }}>
            Pedro
          </p>
          <p className="text-[10px] truncate mt-0.5" style={{ color: '#3A3D4D' }}>
            pedro@kapta.pt
          </p>
        </div>
      </div>
    </aside>
  )
}
