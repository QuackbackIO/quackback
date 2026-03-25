'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { setWidgetToken, clearWidgetToken } from '@/lib/client/widget-auth'
import { widgetQueryKeys } from '@/lib/client/hooks/use-widget-vote'
import { authClient } from '@/lib/server/auth/client'
import type { WidgetMetadata, WidgetEventName, WidgetEventMap } from '@/lib/shared/widget/types'

interface WidgetUser {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

interface WidgetAuthContextValue {
  user: WidgetUser | null
  isIdentified: boolean
  /** Ensures a session exists (identified or anonymous). Returns true if ready. */
  ensureSession: () => Promise<boolean>
  /** Identify by email (inline capture). Returns true on success. */
  identifyWithEmail: (email: string, name?: string) => Promise<boolean>
  closeWidget: () => void
  /** Emit an event to the parent SDK via postMessage */
  emitEvent: <T extends WidgetEventName>(name: T, payload: WidgetEventMap[T]) => void
  /** Session metadata set by the host app */
  metadata: WidgetMetadata | null
  /** Increments when the session token changes — use in query keys to trigger refetch */
  sessionVersion: number
}

const WidgetAuthContext = createContext<WidgetAuthContextValue | null>(null)

export function useWidgetAuth(): WidgetAuthContextValue {
  const ctx = useContext(WidgetAuthContext)
  if (!ctx) throw new Error('useWidgetAuth must be used inside WidgetAuthProvider')
  return ctx
}

interface WidgetAuthProviderProps {
  /** Portal user identity — if set, the widget exchanges for a bearer token on mount */
  portalUser?: WidgetUser | null
  children: ReactNode
}

export function WidgetAuthProvider({ portalUser, children }: WidgetAuthProviderProps) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<WidgetUser | null>(null)
  const [sessionVersion, setSessionVersion] = useState(0)
  const isIdentified = user !== null
  const sessionReadyRef = useRef(false)

  const sessionVersionRef = useRef(0)
  const storeToken = useCallback((token: string) => {
    setWidgetToken(token)
    sessionReadyRef.current = true
    sessionVersionRef.current += 1
    setSessionVersion(sessionVersionRef.current)
  }, [])

  /**
   * Ensure a session exists. For identified users, this is already done via identify().
   * For anonymous users, the session is created eagerly during identify({ anonymous: true }).
   * This is kept as a fallback but should return true immediately after identify.
   */
  const sessionPromiseRef = useRef<Promise<boolean> | null>(null)
  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (sessionReadyRef.current) return true
    if (sessionPromiseRef.current) return sessionPromiseRef.current

    const p = (async () => {
      try {
        const { data, error } = await authClient.signIn.anonymous({
          fetchOptions: {
            onSuccess: (ctx) => {
              const token = ctx.response.headers.get('set-auth-token')
              if (token) storeToken(token)
            },
          },
        })
        return !error && !!data
      } catch {
        return false
      } finally {
        sessionPromiseRef.current = null
      }
    })()
    sessionPromiseRef.current = p
    return p
  }, [storeToken])

  /** Shared success path for both SDK identify and inline email capture */
  const applyIdentifyResult = useCallback(
    (result: { sessionToken: string; user: WidgetUser; votedPostIds?: string[] }) => {
      storeToken(result.sessionToken)
      setUser(result.user)
      if (result.votedPostIds) {
        queryClient.setQueryData(
          widgetQueryKeys.votedPosts.bySession(sessionVersionRef.current),
          new Set<string>(result.votedPostIds)
        )
      }
      window.parent.postMessage(
        { type: 'quackback:identify-result', success: true, user: result.user },
        '*'
      )
      window.parent.postMessage({ type: 'quackback:auth-change', user: result.user }, '*')
    },
    [storeToken, queryClient]
  )

  const identifyPromiseRef = useRef<Promise<boolean> | null>(null)
  const identifyWithEmail = useCallback(
    (email: string, name?: string): Promise<boolean> => {
      if (identifyPromiseRef.current) return identifyPromiseRef.current

      const p = (async () => {
        try {
          const response = await fetch('/api/widget/identify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: email, email, name: name || email.split('@')[0] }),
          })
          if (!response.ok) return false
          applyIdentifyResult(await response.json())
          return true
        } catch {
          return false
        } finally {
          identifyPromiseRef.current = null
        }
      })()
      identifyPromiseRef.current = p
      return p
    },
    [applyIdentifyResult]
  )

  // If user is logged into the portal, exchange their identity for a bearer token on mount.
  // This runs once — subsequent SDK identify() calls will override it.
  const portalHydratedRef = useRef(false)
  useEffect(() => {
    if (portalUser && !portalHydratedRef.current && !sessionReadyRef.current) {
      portalHydratedRef.current = true
      identifyWithEmail(portalUser.email, portalUser.name)
    }
  }, [portalUser, identifyWithEmail])

  const closeWidget = useCallback(() => {
    window.parent.postMessage({ type: 'quackback:close' }, '*')
  }, [])

  const emitEvent = useCallback(
    <T extends WidgetEventName>(name: T, payload: WidgetEventMap[T]) => {
      window.parent.postMessage({ type: 'quackback:event', name, payload }, '*')
    },
    []
  )

  const [widgetMetadata, setWidgetMetadata] = useState<WidgetMetadata | null>(null)

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

        applyIdentifyResult(await response.json())
      } catch {
        window.parent.postMessage(
          { type: 'quackback:identify-result', success: false, error: 'NETWORK_ERROR' },
          '*'
        )
      }
    }

    async function handleAnonymousIdentify() {
      try {
        let token: string | null = null
        const { error } = await authClient.signIn.anonymous({
          fetchOptions: {
            onSuccess: (ctx) => {
              token = ctx.response.headers.get('set-auth-token')
              if (token) storeToken(token)
            },
          },
        })
        if (error || !token) {
          window.parent.postMessage(
            { type: 'quackback:identify-result', success: false, error: 'ANON_SESSION_FAILED' },
            '*'
          )
          return
        }
        // Clear any previous identified user since this is now an anonymous session
        setUser(null)
        window.parent.postMessage(
          { type: 'quackback:identify-result', success: true, user: null },
          '*'
        )
        window.parent.postMessage({ type: 'quackback:auth-change', user: null }, '*')
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

      if (msg.type === 'quackback:metadata' && msg.data && typeof msg.data === 'object') {
        setWidgetMetadata(msg.data as WidgetMetadata)
        return
      }

      if (msg.type === 'quackback:identify') {
        if (msg.data === null) {
          clearWidgetToken()
          sessionReadyRef.current = false
          sessionPromiseRef.current = null
          sessionVersionRef.current += 1
          setSessionVersion(sessionVersionRef.current)
          setUser(null)
          window.parent.postMessage(
            { type: 'quackback:identify-result', success: true, user: null },
            '*'
          )
          window.parent.postMessage({ type: 'quackback:auth-change', user: null }, '*')
        } else if (msg.data?.anonymous === true) {
          handleAnonymousIdentify()
        } else if (msg.data && typeof msg.data === 'object') {
          handleIdentify(msg.data as Record<string, unknown>)
        }
      }
    }

    window.addEventListener('message', handleMessage)
    window.parent.postMessage({ type: 'quackback:ready' }, '*')

    return () => window.removeEventListener('message', handleMessage)
  }, [storeToken, applyIdentifyResult])

  const contextValue = useMemo(
    () => ({
      user,
      isIdentified,
      ensureSession,
      identifyWithEmail,
      closeWidget,
      emitEvent,
      metadata: widgetMetadata,
      sessionVersion,
    }),
    [
      user,
      isIdentified,
      ensureSession,
      identifyWithEmail,
      closeWidget,
      emitEvent,
      widgetMetadata,
      sessionVersion,
    ]
  )

  return <WidgetAuthContext.Provider value={contextValue}>{children}</WidgetAuthContext.Provider>
}
