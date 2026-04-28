'use client'

import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  disabled?: boolean
}

export function TagInput({ value, onChange, placeholder, disabled }: Props) {
  const [draft, setDraft] = useState('')

  function commit() {
    const t = draft.trim()
    if (!t) return
    if (!value.includes(t)) onChange([...value, t])
    setDraft('')
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 min-h-[38px]"
      style={{ borderColor: 'var(--border)', background: 'var(--background)' }}
    >
      {value.map((tag, idx) => (
        <span
          key={`${tag}-${idx}`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-mono"
          style={{ background: 'rgba(91,91,214,0.1)', color: 'var(--primary)' }}
        >
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => remove(idx)}
              className="hover:opacity-70"
              aria-label={`Remover ${tag}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      ))}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={commit}
        placeholder={value.length === 0 ? placeholder : ''}
        disabled={disabled}
        className="flex-1 min-w-[120px] border-0 shadow-none focus-visible:ring-0 px-1 py-0 h-6 text-[13px] bg-transparent"
      />
    </div>
  )
}
