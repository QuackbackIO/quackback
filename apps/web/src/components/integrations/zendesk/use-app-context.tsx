import { createContext, useContext, useCallback, type ReactNode } from 'react'
import type { TicketContext } from './use-zaf-client'

interface AppContextValue {
  apiKey: string
  baseUrl: string
  ticket: TicketContext
  /** Fetch helper that injects auth headers */
  appFetch: (path: string, init?: RequestInit) => Promise<Response>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppContextProvider({
  apiKey,
  baseUrl,
  ticket,
  children,
}: {
  apiKey: string
  baseUrl: string
  ticket: TicketContext
  children: ReactNode
}) {
  const appFetch = useCallback(
    (path: string, init?: RequestInit) => {
      const url = `${baseUrl}${path}`
      return fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...init?.headers,
        },
      })
    },
    [apiKey, baseUrl]
  )

  return (
    <AppContext.Provider value={{ apiKey, baseUrl, ticket, appFetch }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppContextProvider')
  return ctx
}
