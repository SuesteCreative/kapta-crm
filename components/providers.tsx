'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Stale 30s — within that window navigating back to a page hits the cache,
// no refetch. After 30s the next render kicks a background refetch while
// showing the cached data. gcTime 5min — keeps unmounted query data alive
// for back-nav.
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: fresh client per request so cache doesn't leak between users.
    return makeQueryClient()
  }
  // Browser: singleton across the tab's lifetime.
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(getQueryClient)
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
