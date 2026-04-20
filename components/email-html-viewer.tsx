'use client'

import { useMemo } from 'react'
import DOMPurify from 'dompurify'

type Props = {
  html?: string | null
  text?: string | null
  className?: string
}

/**
 * Render email body: prefer sanitized HTML (preserves tables, lists, links),
 * fall back to plain text. Strips scripts, event handlers, iframes.
 */
export function EmailHtmlViewer({ html, text, className }: Props) {
  const sanitized = useMemo(() => {
    if (!html) return null
    if (typeof window === 'undefined') return null
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      ADD_ATTR: ['target', 'rel'],
    })
  }, [html])

  if (sanitized) {
    return (
      <div
        className={`email-html-body ${className ?? ''}`}
        style={{ color: 'var(--foreground)', fontSize: 13, lineHeight: 1.6 }}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    )
  }

  if (text) {
    return (
      <pre
        className={`text-[13px] whitespace-pre-wrap break-words font-sans leading-relaxed ${className ?? ''}`}
        style={{ color: 'var(--foreground)' }}
      >
        {text}
      </pre>
    )
  }

  return (
    <p className="text-[13px] italic" style={{ color: 'var(--muted-foreground)' }}>
      (sem corpo)
    </p>
  )
}
