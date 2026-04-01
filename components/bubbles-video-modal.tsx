'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ExternalLink } from 'lucide-react'
import { getBubblesEmbedUrl } from '@/lib/utils'

interface Props { url: string | null; onClose: () => void }

export function BubblesVideoModal({ url, onClose }: Props) {
  if (!url) return null
  const embedUrl = getBubblesEmbedUrl(url)

  return (
    <Dialog open={!!url} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl w-full p-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b flex flex-row items-center justify-between">
          <DialogTitle className="text-base">Gravação Bubbles</DialogTitle>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <ExternalLink className="h-4 w-4" /> Abrir em Bubbles
            </Button>
          </a>
        </DialogHeader>

        {embedUrl ? (
          <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
            <iframe
              src={embedUrl}
              className="absolute inset-0 w-full h-full"
              allowFullScreen
              allow="autoplay; fullscreen"
              title="Bubbles recording"
            />
          </div>
        ) : (
          // Fallback if embed URL pattern doesn't match
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-sm text-slate-500">Não foi possível incorporar o vídeo diretamente.</p>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Button>
                <ExternalLink className="h-4 w-4 mr-2" /> Abrir em Bubbles
              </Button>
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
