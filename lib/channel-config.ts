import { Mail, MessageSquare, Video, Phone, FileText } from 'lucide-react'
import type React from 'react'

export const CHANNEL_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  email:    { icon: Mail,          color: 'var(--interaction-email)',   bg: 'rgba(59,130,246,0.1)',   label: 'Email'    },
  whatsapp: { icon: MessageSquare, color: 'var(--status-active)',       bg: 'rgba(45,185,117,0.1)',   label: 'WhatsApp' },
  meeting:  { icon: Video,         color: 'var(--interaction-meeting)', bg: 'rgba(139,92,246,0.1)',   label: 'Reunião'  },
  call:     { icon: Phone,         color: 'var(--status-troubleshoot)', bg: 'rgba(249,115,22,0.1)',   label: 'Chamada'  },
  note:     { icon: FileText,      color: 'var(--interaction-note)',    bg: 'rgba(156,163,175,0.1)',  label: 'Nota'     },
}
