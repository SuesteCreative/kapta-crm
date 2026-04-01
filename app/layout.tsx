import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { Sidebar } from '@/components/sidebar'

export const metadata: Metadata = {
  title: 'Kapta CRM',
  description: 'Customer hub for Kapta',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" className="h-full">
      <body className="h-full" style={{ fontFamily: "'Outfit', sans-serif" }}>
        <div className="flex h-full">
          <Sidebar />
          <main className="flex-1 overflow-auto bg-[var(--background)]">
            {children}
          </main>
        </div>
        <Toaster
          richColors
          position="top-right"
          toastOptions={{
            style: { fontFamily: "'Outfit', sans-serif", fontSize: '14px' },
          }}
        />
      </body>
    </html>
  )
}
