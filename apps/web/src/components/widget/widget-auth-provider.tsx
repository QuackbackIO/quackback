'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

interface WidgetUser {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

interface WidgetAuthContextValue {
  user: WidgetUser | null
  isIdentified: boolean
  widgetFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  closeWidget: () => void
}

const WidgetAuthContext = createContext<WidgetAuthContextValue | null>(null)

export function useWidgetAuth(): WidgetAuthContextValue {
  const ctx = useContext(WidgetAuthContext)
  if (!ctx) throw new Error('useWidgetAuth must be used inside WidgetAuthProvider')
  return ctx
}

export function WidgetAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WidgetUser | null>(null)
  const tokenRef = useRef<string | null>(null)

  const isIdentified = user !== null

  const widgetFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const token = tokenRef.current
      if (!token) return fetch(input, init)

      const request = new Request(input, init)
      if (new URL(request.url).origin === window.location.origin) {
        const headers = new Headers(request.headers)
        headers.set('Authorization', `Bearer ${token}`)
        return fetch(new Request(request, { headers }))
      }
      return fetch(input, init)
    },
    []
  )

  const closeWidget = useCallback(() => {
    window.parent.postMessage({ type: 'quackback:close' }, '*')
  }, [])

  useEffect(() => {
    async function handleIdentify(data: Record<string, unknown>) {
      try {
        const response = await fetch('/api/widget/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: { code: 'NETWORK_ERROR' } }))
          window.parent.postMessage(
            {
              type: 'quackback:identify-result',
              success: false,
              error: err.error?.code || 'SERVER_ERROR',
            },
            '*'
          )
          return
        }

        const result = await response.json()
        tokenRef.current = result.sessionToken
        setUser(result.user)

        window.parent.postMessage(
          { type: 'quackback:identify-result', success: true, user: result.user },
          '*'
        )
        window.parent.postMessage({ type: 'quackback:auth-change', user: result.user }, '*')
      } catch {
        window.parent.postMessage(
          { type: 'quackback:identify-result', success: false, error: 'NETWORK_ERROR' },
          '*'
        )
      }
    }

    function handleMessage(event: MessageEvent) {
      if (event.source !== window.parent) return

      const msg = event.data
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return

      if (msg.type === 'quackback:identify') {
        if (msg.data === null) {
          tokenRef.current = null
          setUser(null)
          window.parent.postMessage(
            { type: 'quackback:identify-result', success: true, user: null },
            '*'
          )
          window.parent.postMessage({ type: 'quackback:auth-change', user: null }, '*')
        } else if (msg.data && typeof msg.data === 'object') {
          handleIdentify(msg.data as Record<string, unknown>)
        }
      }
    }

    window.addEventListener('message', handleMessage)
    window.parent.postMessage({ type: 'quackback:ready' }, '*')

    return () => window.removeEventListener('message', handleMessage)
  }, [])

  return (
    <WidgetAuthContext.Provider value={{ user, isIdentified, widgetFetch, closeWidget }}>
      {children}
    </WidgetAuthContext.Provider>
  )
}
