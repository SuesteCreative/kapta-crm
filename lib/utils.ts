import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, isToday, isTomorrow, isPast } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return format(new Date(date), 'dd MMM yyyy', { locale: ptBR })
}

export function formatDateTime(date: string | Date) {
  return format(new Date(date), 'dd MMM yyyy, HH:mm', { locale: ptBR })
}

export function timeAgo(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR })
}

export function dueDateLabel(dateStr: string | null): { label: string; color: string } {
  if (!dateStr) return { label: 'Sem data', color: 'text-muted-foreground' }
  const d = new Date(dateStr)
  if (isPast(d) && !isToday(d)) return { label: `Atrasado — ${formatDate(d)}`, color: 'text-red-500' }
  if (isToday(d)) return { label: 'Hoje', color: 'text-orange-500' }
  if (isTomorrow(d)) return { label: 'Amanhã', color: 'text-yellow-500' }
  return { label: formatDate(d), color: 'text-muted-foreground' }
}

export const STATUS_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  active: 'Ativo',
  'at-risk': 'Em risco',
  troubleshooting: 'Suporte',
  churned: 'Cancelado',
}

// Status badge styles — inline CSS vars for design system consistency
export const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  onboarding:     { bg: 'rgba(91,91,214,0.1)',  text: '#5B5BD6', dot: '#5B5BD6' },
  active:         { bg: 'rgba(45,185,117,0.1)', text: '#1a9e6c', dot: '#2DB975' },
  'at-risk':      { bg: 'rgba(245,158,11,0.1)', text: '#B45309', dot: '#F59E0B' },
  troubleshooting:{ bg: 'rgba(249,115,22,0.1)', text: '#C2410C', dot: '#F97316' },
  churned:        { bg: 'rgba(229,72,77,0.1)',  text: '#C0272B', dot: '#E5484D' },
}

// Kept for shadcn Badge className fallback
export const STATUS_COLORS: Record<string, string> = {
  onboarding: 'bg-violet-100 text-violet-700',
  active: 'bg-emerald-100 text-emerald-700',
  'at-risk': 'bg-amber-100 text-amber-700',
  troubleshooting: 'bg-orange-100 text-orange-700',
  churned: 'bg-red-100 text-red-700',
}

export const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  low:    { bg: 'rgba(160,174,192,0.12)', text: '#64748B' },
  medium: { bg: 'rgba(59,130,246,0.1)',  text: '#1D4ED8' },
  high:   { bg: 'rgba(249,115,22,0.1)',  text: '#C2410C' },
  urgent: { bg: 'rgba(229,72,77,0.1)',   text: '#C0272B' },
}

export const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

// AI urgency panel styles — shared between customer-detail and company-detail
export const URGENCY_STYLES: Record<string, { border: string; bg: string; dot: string; label: string }> = {
  critical: { border: 'var(--destructive)',  bg: 'rgba(229,72,77,0.07)',   dot: 'var(--destructive)', label: 'Crítico' },
  high:     { border: '#F59E0B',             bg: 'rgba(245,158,11,0.07)', dot: '#F59E0B',             label: 'Urgente' },
  normal:   { border: 'var(--border)',       bg: 'rgba(91,91,214,0.05)',  dot: 'var(--primary)',      label: ''        },
  good:     { border: 'var(--status-active)',bg: 'rgba(45,185,117,0.06)', dot: 'var(--status-active)',label: ''        },
}

export const HEALTH_COLORS: Record<number, string> = {
  1: 'text-red-500',
  2: 'text-orange-400',
  3: 'text-yellow-400',
  4: 'text-lime-400',
  5: 'text-emerald-500',
}

/** Clamps health_score to 1–5 and returns the matching color class. Safe for any DB value. */
export function healthColor(score: number): string {
  const clamped = Math.max(1, Math.min(5, Math.round(score)))
  return HEALTH_COLORS[clamped] ?? 'text-muted-foreground'
}

/** Extract Bubbles video ID from URL for embed */
export function getBubblesEmbedUrl(url: string): string | null {
  const match = url.match(/usebubbles\.com\/([a-zA-Z0-9]+)/)
  if (!match) return null
  return `https://app.usebubbles.com/embed/${match[1]}`
}
