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
import { IntlProvider } from 'react-intl'
import { setWidgetToken, clearWidgetToken, getWidgetToken } from '@/lib/client/widget-auth'
import { sendToHost } from '@/lib/client/widget-bridge'
import { widgetQueryKeys } from '@/lib/client/hooks/use-widget-vote'
import { authClient } from '@/lib/server/auth/client'
import { resolveIdentifyAction, type SessionSource } from './identify-precedence'
import type { WidgetMetadata, WidgetEventName, WidgetEventMap } from '@/lib/shared/widget/types'
import { normalizeLocale, DEFAULT_LOCALE, type SupportedLocale } from '@/lib/shared/i18n'
import { useIntlSetup } from '@/lib/client/hooks/use-intl-setup'
import { createWidgetIdentifyTokenFn } from '@/lib/server/functions/widget'

interface WidgetUser {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

interface WidgetAuthContextValue {
  user: WidgetUser | null
  isIdentified: boolean
  /** Whether verified identity is required (inline email capture disabled) */
  hmacRequired: boolean
  /** Ensures a session exists (identified or anonymous). Returns true if ready. */
  ensureSession: () => Promise<boolean>
  /** Ensures a session exists before performing a write action. Creates anonymous session if needed. */
  ensureSessionThen: (callback: () => void | Promise<void>) => Promise<void>
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
  /** Portal user identity — if set, the widget displays their info */
  portalUser?: WidgetUser | null
  /** Signed session cookie token extracted during SSR (available in cross-origin iframes) */
  portalSessionToken?: string | null
  /** When true, inline email capture is disabled and the host app must sign users. */
  hmacRequired?: boolean
  /** Initial locale from URL param (?locale=fr). SDK postMessage overrides this. */
  initialLocale?: string | null
  children: ReactNode
}

export function WidgetAuthProvider({
  portalUser,
  portalSessionToken,
  hmacRequired,
  initialLocale,
  children,
}: WidgetAuthProviderProps) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<WidgetUser | null>(null)
  const [sessionVersion, setSessionVersion] = useState(0)
  const isIdentified = user !== null
  const sessionReadyRef = useRef(false)
  const sessionSourceRef = useRef<SessionSource>(null)

  // i18n locale state
  const [locale, setLocale] = useState<SupportedLocale>(() => {
    if (initialLocale) {
      return normalizeLocale(initialLocale) ?? DEFAULT_LOCALE
    }
    if (typeof navigator !== 'undefined') {
      return normalizeLocale(navigator.language) ?? DEFAULT_LOCALE
    }
    return DEFAULT_LOCALE
  })
  const messages = useIntlSetup(locale)

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
            // credentials: 'omit' prevents the browser from sending the
            // existing portal session cookie and from accepting the Set-Cookie
            // response, so the widget iframe doesn't overwrite the portal session.
            // The Bearer token is still returned via the set-auth-token header.
            credentials: 'omit',
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

  const ensureSessionThen = useCallback(
    async (callback: () => void | Promise<void>) => {
      if (sessionReadyRef.current) {
        await callback()
        return
      }
      const success = await ensureSession()
      if (success) {
        await callback()
      }
    },
    [ensureSession]
  )

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
      sendToHost({ type: 'quackback:identify-result', success: true, user: result.user })
      sendToHost({ type: 'quackback:auth-change', user: result.user })
    },
    [storeToken, queryClient]
  )

  const identifyPromiseRef = useRef<Promise<boolean> | null>(null)
  const identifyWithEmail = useCallback(
    (email: string, name?: string): Promise<boolean> => {
      if (identifyPromiseRef.current) return identifyPromiseRef.current

      const p = (async () => {
        try {
          if (hmacRequired) return false

          const previousToken = getWidgetToken()
          const { ssoToken } = await createWidgetIdentifyTokenFn({
            data: { email, name: name || email.split('@')[0] },
          })

          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (previousToken) {
            headers.Authorization = `Bearer ${previousToken}`
          }

          const response = await fetch('/api/widget/identify', {
            method: 'POST',
            headers,
            body: JSON.stringify(previousToken ? { ssoToken, previousToken } : { ssoToken }),
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
    [applyIdentifyResult, hmacRequired]
  )

  // If a portal session token was extracted during SSR, use it directly as the
  // widget's Bearer token. This works in both same-origin AND cross-origin iframes
  // because the token is extracted during the initial navigation (where SameSite=Lax
  // cookies are available) and passed via loader data.
  // SDK identify() calls via postMessage will override this if received.
  const portalHydratedRef = useRef(false)
  useEffect(() => {
    if (!portalSessionToken || portalHydratedRef.current || sessionReadyRef.current) return
    portalHydratedRef.current = true
    sessionSourceRef.current = 'portal'
    storeToken(portalSessionToken)
    if (portalUser) {
      setUser(portalUser)
      sendToHost({ type: 'quackback:identify-result', success: true, user: portalUser })
      sendToHost({ type: 'quackback:auth-change', user: portalUser })
    }
  }, [portalSessionToken, portalUser, storeToken])

  const closeWidget = useCallback(() => {
    sendToHost({ type: 'quackback:close' })
  }, [])

  const emitEvent = useCallback(
    <T extends WidgetEventName>(name: T, payload: WidgetEventMap[T]) => {
      sendToHost({ type: 'quackback:event', name, payload })
    },
    []
  )

  const [widgetMetadata, setWidgetMetadata] = useState<WidgetMetadata | null>(null)

  useEffect(() => {
    async function handleIdentify(data: Record<string, unknown>) {
      try {
        // Capture current token before the identify call — if it's an anonymous
        // session, the server will merge its activity into the newly identified user.
        const previousToken = getWidgetToken()
        const payload = previousToken ? { ...data, previousToken } : data

        // Send previousToken as Bearer header too — the server verifies ownership
        // by checking that the Bearer header matches the previousToken body field.
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (previousToken) {
          headers['Authorization'] = `Bearer ${previousToken}`
        }

        const response = await fetch('/api/widget/identify', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: { code: 'NETWORK_ERROR' } }))
          sendToHost({
            type: 'quackback:identify-result',
            success: false,
            error: err.error?.code || 'SERVER_ERROR',
          })
          return
        }

        applyIdentifyResult(await response.json())
      } catch {
        sendToHost({ type: 'quackback:identify-result', success: false, error: 'NETWORK_ERROR' })
      }
    }

    async function handleAnonymousIdentify() {
      // Don't eagerly create anonymous session — it will be created lazily
      // on first write action (vote, comment, post) via ensureSessionThen.
      setUser(null)
      sendToHost({ type: 'quackback:identify-result', success: true, user: null })
      sendToHost({ type: 'quackback:auth-change', user: null })
    }

    function handleMessage(event: MessageEvent) {
      if (event.source !== window.parent) return

      const msg = event.data
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return

      if (msg.type === 'quackback:metadata' && msg.data && typeof msg.data === 'object') {
        setWidgetMetadata(msg.data as WidgetMetadata)
        return
      }

      if (msg.type === 'quackback:locale' && typeof msg.data === 'string') {
        const normalized = normalizeLocale(msg.data)
        if (normalized) setLocale(normalized)
        return
      }

      if (msg.type === 'quackback:identify') {
        const action = resolveIdentifyAction({
          identifyData: msg.data,
          hasPortalSession: !!portalSessionToken,
          sessionSource: sessionSourceRef.current,
        })

        switch (action) {
          case 'clear':
            clearWidgetToken()
            sessionReadyRef.current = false
            sessionSourceRef.current = null
            sessionPromiseRef.current = null
            sessionVersionRef.current += 1
            setSessionVersion(sessionVersionRef.current)
            setUser(null)
            sendToHost({ type: 'quackback:identify-result', success: true, user: null })
            sendToHost({ type: 'quackback:auth-change', user: null })
            break
          case 'anonymous':
            handleAnonymousIdentify()
            break
          case 'identify':
            sessionSourceRef.current = 'sdk'
            handleIdentify(msg.data as Record<string, unknown>)
            break
          case 'skip':
            // Portal session takes precedence — ack without changing state
            sendToHost({ type: 'quackback:identify-result', success: true, user: user ?? null })
            sendToHost({ type: 'quackback:auth-change', user: user ?? null })
            break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    sendToHost({ type: 'quackback:ready' })

    return () => window.removeEventListener('message', handleMessage)
  }, [storeToken, applyIdentifyResult])

  const contextValue = useMemo(
    () => ({
      user,
      isIdentified,
      hmacRequired: hmacRequired ?? false,
      ensureSession,
      ensureSessionThen,
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
      ensureSessionThen,
      identifyWithEmail,
      closeWidget,
      emitEvent,
      widgetMetadata,
      sessionVersion,
    ]
  )

  return (
    <IntlProvider locale={locale} messages={messages} defaultLocale={DEFAULT_LOCALE}>
      <WidgetAuthContext.Provider value={contextValue}>{children}</WidgetAuthContext.Provider>
    </IntlProvider>
  )
}
