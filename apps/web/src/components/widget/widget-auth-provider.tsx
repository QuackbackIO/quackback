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
import {
  setWidgetToken,
  clearWidgetToken,
  getWidgetToken,
  persistAnonymousToken,
  readPersistedToken,
  clearPersistedToken,
} from '@/lib/client/widget-auth'
import { hostOriginIsOpaque, sendToHost } from '@/lib/client/widget-bridge'
import {
  frameHasHost,
  frameParentIsSameOrigin,
  setFrameHoldsPortalSession,
} from '@/lib/client/widget-frame'
import { startingSessionVersion, widgetQueryKeys } from '@/lib/client/hooks/use-widget-vote'
import { authClient } from '@/lib/client/auth-client'
import { resolveIdentifyAction, type SessionSource } from './identify-precedence'
import type { WidgetMetadata, WidgetEventName, WidgetEventMap } from '@/lib/shared/widget/types'
import { normalizeLocale, DEFAULT_LOCALE, type SupportedLocale } from '@/lib/shared/i18n'
import { htmlLangDir } from '@/lib/shared/document-locale'
import { useIntlSetup } from '@/lib/client/hooks/use-intl-setup'
import { onIntlError } from '@/lib/client/intl-error'

interface WidgetUser {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

interface WidgetAuthContextValue {
  user: WidgetUser | null
  isIdentified: boolean
  /**
   * Whether the widget knows yet who this visitor is. False from mount until
   * the portal session hydrates or the SDK's first `quackback:identify`
   * (named, anonymous, or clear) has been handled — the SDK always sends one
   * right after `quackback:ready`. While false, `isIdentified === false` means
   * "not yet", not "anonymous"; identity-dependent chrome (the Tickets tab)
   * should hold its initial state rather than commit to the anonymous shape.
   */
  identityResolved: boolean
  /** Whether verified identity is required (inline email capture disabled) */
  hmacRequired: boolean
  /**
   * Whether this identity may mint a portal one-time token. False for workspace
   * teammates so "Go to portal" / "View on board" do not replace a dashboard login.
   */
  canPortalHandoff: boolean
  /** Ensures a session exists (identified or anonymous). Returns true if ready. */
  ensureSession: () => Promise<boolean>
  /** Ensures a session exists before performing a write action. Creates anonymous session if needed. */
  ensureSessionThen: (callback: () => void | Promise<void>) => Promise<void>
  closeWidget: () => void
  /** Emit an event to the parent SDK via postMessage */
  emitEvent: <T extends WidgetEventName>(name: T, payload: WidgetEventMap[T]) => void
  /** Session metadata set by the host app */
  metadata: WidgetMetadata | null
  /** Increments when the session token changes — use in query keys to trigger refetch */
  sessionVersion: number
  /** Latest sessionVersion, readable inside async handlers after ensureSession()
   *  may have bumped it (the rendered `sessionVersion` closure would be stale). */
  getSessionVersion: () => number
}

const WidgetAuthContext = createContext<WidgetAuthContextValue | null>(null)

export function useWidgetAuth(): WidgetAuthContextValue {
  const ctx = useContext(WidgetAuthContext)
  if (!ctx) throw new Error('useWidgetAuth must be used inside WidgetAuthProvider')
  return ctx
}

interface WidgetAuthProviderProps {
  /**
   * Portal user identity — if set, the widget displays their info. Adopted
   * once with `portalSessionToken`: a later null (the loader re-running on the
   * client, where it never carries the portal session) leaves the adopted
   * session and user in place.
   */
  portalUser?: WidgetUser | null
  /**
   * Signed portal session token, set by the server only for a same-origin
   * frame navigation; the frame adopts it only when its parent page is on its
   * own origin too.
   */
  portalSessionToken?: string | null
  /** When true, inline email capture is disabled and the host app must sign users. */
  hmacRequired?: boolean
  /** False when the same-origin portal cookie belongs to a workspace teammate. */
  canPortalHandoff?: boolean
  /** Locale resolved on the server (Accept-Language header + ?locale=
   *  override). Deriving it from navigator at render time diverges from
   *  SSR and triggers React hydration error #418 — see issue #133. An SDK
   *  postMessage (quackback:locale) still overrides it after mount. */
  initialLocale?: SupportedLocale
  /** Catalog slice for `initialLocale`, loaded server-side in the widget
   *  layout loader so the first render is translated without a client
   *  catalog fetch. A runtime locale change still fetches the new catalog. */
  initialMessages?: Record<string, string>
  children: ReactNode
}

/**
 * How long an embedded frame waits for its host's first identity before it
 * treats the visitor as anonymous. The SDK sends one as soon as the frame is
 * ready; a frame shown without the SDK (a settings preview) never gets one.
 */
export const IDENTITY_HANDSHAKE_TIMEOUT_MS = 1500

export function WidgetAuthProvider({
  portalUser: portalUserProp,
  portalSessionToken: portalSessionTokenProp,
  hmacRequired,
  canPortalHandoff: canPortalHandoffFromPortal,
  initialLocale,
  initialMessages,
  children,
}: WidgetAuthProviderProps) {
  const queryClient = useQueryClient()
  // The server hands over the portal session only for a same-origin
  // navigation, which a navigation started inside the frame also is. The frame
  // takes it only when its parent page is on its own origin (or it is the top
  // page); otherwise it starts as for an anonymous visitor (widget-frame.ts).
  const [frameMayHoldPortalSession] = useState(frameParentIsSameOrigin)
  const portalSessionToken = frameMayHoldPortalSession ? portalSessionTokenProp : null
  const portalUser = frameMayHoldPortalSession ? portalUserProp : null
  // A portal session the page hands the widget is adopted before the first
  // render, so every identity-keyed read starts on it, one version past the
  // anonymous server-rendered baseline. Adopted in an effect after mount, each
  // of those reads ran once without it and then again for the new version.
  // Decided before any child renders, so the frame's server function calls
  // know from the start whether they may carry cookies.
  const [portalSessionAdopted] = useState(() => {
    if (typeof window === 'undefined') return false
    const adopted = !!portalSessionToken
    setFrameHoldsPortalSession(adopted)
    if (adopted) setWidgetToken(portalSessionToken)
    return adopted
  })
  const initialSessionVersion = startingSessionVersion(portalSessionAdopted)
  const [user, setUserState] = useState<WidgetUser | null>(null)
  const [canPortalHandoff, setCanPortalHandoff] = useState(canPortalHandoffFromPortal ?? true)
  const [sessionVersion, setSessionVersion] = useState(initialSessionVersion)
  const [identityResolved, setIdentityResolved] = useState(false)
  const isIdentified = user !== null
  // The current user for handlers registered once at mount, whose `user`
  // closure would still be the initial null. Written with every change.
  const userRef = useRef(user)
  const setUser = useCallback((next: WidgetUser | null) => {
    userRef.current = next
    setUserState(next)
  }, [])
  const sessionReadyRef = useRef(portalSessionAdopted)
  const sessionSourceRef = useRef<SessionSource>(portalSessionAdopted ? 'portal' : null)

  // Durable device id from the host page (visitor analytics layer 2). Linked
  // to the session's principal server-side; deduped per (device, token) so
  // auth-state changes re-link at most once each.
  const deviceIdRef = useRef<string | null>(null)
  const lastDeviceLinkRef = useRef<string | null>(null)
  const attemptDeviceLink = useCallback(() => {
    const deviceId = deviceIdRef.current
    const token = getWidgetToken()
    if (!deviceId || !token) return
    const linkKey = `${deviceId}:${token}`
    if (lastDeviceLinkRef.current === linkKey) return
    lastDeviceLinkRef.current = linkKey
    void fetch('/api/widget/device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId }),
    }).catch(() => {})
  }, [])
  useEffect(() => {
    attemptDeviceLink()
  }, [attemptDeviceLink, user, sessionVersion])

  // i18n locale state — seeded from the SSR-resolved prop only, so the
  // first client render matches the server (see issue #133).
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale ?? DEFAULT_LOCALE)
  const messages = useIntlSetup(locale, initialMessages)

  // The widget is its own iframe document, and its locale can change at runtime
  // (the `quackback:locale` postMessage below). Unlike the portal, the root
  // document can't track that, so the widget owns its own `<html lang>`/`dir`,
  // formatted the same way the root document does.
  useEffect(() => {
    const { lang, dir } = htmlLangDir(locale)
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }, [locale])

  const sessionVersionRef = useRef(initialSessionVersion)
  const getSessionVersion = useCallback(() => sessionVersionRef.current, [])
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
  // Acquire an anonymous session, preferring a persisted token (which survives
  // reloads / new tabs / return visits). `allowMint=false` is the mount-time
  // "restore only" mode — it adopts a still-valid persisted token but never
  // creates a new session, honoring the lazy-mint-on-first-write model.
  // Concurrent callers coalesce on the in-flight attempt; if a restore-only
  // attempt establishes nothing, a mint-allowed caller falls through to mint.
  const sessionPromiseRef = useRef<Promise<boolean> | null>(null)
  const acquireSession = useCallback(
    async (allowMint: boolean): Promise<boolean> => {
      if (sessionReadyRef.current) return true
      const inFlight = sessionPromiseRef.current
      if (inFlight) {
        const ok = await inFlight
        if (ok || sessionReadyRef.current) return true
        if (!allowMint) return false
      }
      if (sessionReadyRef.current) return true
      if (sessionPromiseRef.current) return sessionPromiseRef.current

      const p = (async (): Promise<boolean> => {
        try {
          // 1. Prefer a persisted anonymous token — validate it server-side
          //    before adopting (it may have expired or been merged away).
          const persisted = readPersistedToken()
          if (persisted) {
            try {
              const res = await fetch('/api/widget/session', {
                headers: { Authorization: `Bearer ${persisted}` },
              })
              if (res.ok) {
                storeToken(persisted)
                // Active use rolls the client expiry hint forward (the server
                // session is rolled by the validation endpoint), so the 7-day
                // window tracks activity instead of capping at first mint.
                persistAnonymousToken(persisted)
                return true
              }
            } catch {
              // Server unreachable — fall through and mint if allowed.
            }
            clearWidgetToken() // stale/invalid → drop the persisted copy
          }
          if (!allowMint) return false

          // 2. Lazy-mint a fresh anonymous session. credentials:'omit' keeps the
          //    widget iframe from sending/accepting the portal cookie; the token
          //    arrives via the set-auth-token header and is persisted so it
          //    survives the next reload.
          const { data, error } = await authClient.signIn.anonymous({
            fetchOptions: {
              credentials: 'omit',
              onSuccess: (ctx) => {
                const token = ctx.response.headers.get('set-auth-token')
                if (token) {
                  storeToken(token)
                  persistAnonymousToken(token)
                }
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
    },
    [storeToken]
  )
  const ensureSession = useCallback((): Promise<boolean> => acquireSession(true), [acquireSession])

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
    (result: {
      sessionToken: string
      user: WidgetUser
      votedPostIds?: string[]
      canPortalHandoff?: boolean
    }) => {
      storeToken(result.sessionToken)
      // Any anonymous session was merged into this identified user server-side,
      // so drop its persisted token. Identified tokens are never persisted —
      // they're re-established via SDK identify / portal passthrough on load.
      clearPersistedToken()
      setUser(result.user)
      setCanPortalHandoff(result.canPortalHandoff !== false)
      if (result.votedPostIds) {
        queryClient.setQueryData(
          widgetQueryKeys.votedPosts.bySession(sessionVersionRef.current),
          new Set<string>(result.votedPostIds)
        )
      }
      sendToHost({ type: 'quackback:identify-result', success: true, user: result.user })
      sendToHost({ type: 'quackback:auth-change', user: result.user })
    },
    [storeToken, queryClient, setUser]
  )

  // NOTE: there is deliberately no inline email-capture identify. A verified
  // session comes only from an ssoToken signed by the customer's backend (SDK
  // identify / portal passthrough) — see GH issue #300. Anonymous visitors keep
  // anonymous sessions; the future assistant collects contact info as lead data
  // on the principal instead of minting user sessions.

  // If the loader passed a portal session token (only for an embedding page on
  // the instance's own origin), use it directly as the widget's Bearer token.
  // SDK identify() calls via postMessage will override this if received.
  const portalHydratedRef = useRef(false)
  useEffect(() => {
    if (!portalSessionToken || portalHydratedRef.current) return
    // A token known at mount was adopted before the first render (above); one
    // that arrives later is adopted here, unless a session is already ready.
    if (!portalSessionAdopted) {
      if (sessionReadyRef.current) return
      sessionSourceRef.current = 'portal'
      setFrameHoldsPortalSession(true)
      storeToken(portalSessionToken)
    }
    portalHydratedRef.current = true
    if (portalUser) {
      setUser(portalUser)
      setCanPortalHandoff(canPortalHandoffFromPortal !== false)
      sendToHost({ type: 'quackback:identify-result', success: true, user: portalUser })
      sendToHost({ type: 'quackback:auth-change', user: portalUser })
    }
    setIdentityResolved(true)
  }, [
    portalSessionToken,
    portalSessionAdopted,
    portalUser,
    canPortalHandoffFromPortal,
    storeToken,
    setUser,
  ])

  // Restore a persisted anonymous session on mount so a returning visitor's
  // conversation is visible immediately, without waiting for a write. Skipped
  // when a portal session is present (it takes precedence) or one is already
  // ready. Restore-only: never mints — the first write lazily mints if nothing
  // valid was restored.
  const restoreAttemptedRef = useRef(false)
  useEffect(() => {
    if (restoreAttemptedRef.current) return
    if (portalSessionToken || sessionReadyRef.current) return
    restoreAttemptedRef.current = true
    if (!readPersistedToken()) return
    void acquireSession(false)
  }, [portalSessionToken, acquireSession])

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

  // A frame nobody will identify settles as anonymous: at once when it has no
  // host at all, or once the handshake wait passes with no identity. An
  // identify already on its way settles it instead, and a later one still
  // applies as usual. A portal session settles it on its own (above).
  const identifyReceivedRef = useRef(false)
  useEffect(() => {
    if (portalSessionToken) return
    const settleAnonymous = () => {
      if (!identifyReceivedRef.current) setIdentityResolved(true)
    }
    if (!frameHasHost()) {
      settleAnonymous()
      return
    }
    const timer = setTimeout(settleAnonymous, IDENTITY_HANDSHAKE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [portalSessionToken])

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
      } finally {
        // Resolved only once the round trip settles: between the message and
        // the response `user` is still null, and consumers must not read that
        // window as "this visitor is anonymous".
        setIdentityResolved(true)
      }
    }

    // Drop the current session and start a new session version, so every
    // identity-keyed read refetches for whoever comes next.
    function dropSession() {
      clearWidgetToken()
      sessionReadyRef.current = false
      sessionSourceRef.current = null
      sessionPromiseRef.current = null
      sessionVersionRef.current += 1
      setSessionVersion(sessionVersionRef.current)
    }

    async function handleAnonymousIdentify() {
      // Anonymous on top of a signed-in person is a sign-out: what was fetched
      // for them (their tickets, segment-gated entries) must not carry over.
      if (userRef.current !== null) dropSession()
      // Don't eagerly create anonymous session — it will be created lazily
      // on first write action (vote, comment, post) via ensureSessionThen.
      setUser(null)
      setCanPortalHandoff(true)
      setIdentityResolved(true)
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

      if (msg.type === 'quackback:device' && msg.data === null) {
        // The host withdrew tracking consent: stop linking sessions to the device.
        deviceIdRef.current = null
        lastDeviceLinkRef.current = null
        return
      }

      if (msg.type === 'quackback:device' && typeof msg.data === 'string' && msg.data) {
        deviceIdRef.current = msg.data.slice(0, 128)
        attemptDeviceLink()
        return
      }

      if (msg.type === 'quackback:identify') {
        identifyReceivedRef.current = true
        const action = resolveIdentifyAction({
          identifyData: msg.data,
          hasPortalSession: !!portalSessionToken,
          sessionSource: sessionSourceRef.current,
        })

        switch (action) {
          case 'clear':
            dropSession()
            setUser(null)
            setCanPortalHandoff(true)
            setIdentityResolved(true)
            sendToHost({ type: 'quackback:identify-result', success: true, user: null })
            sendToHost({ type: 'quackback:auth-change', user: null })
            break
          case 'anonymous':
            handleAnonymousIdentify()
            break
          case 'identify':
            // A host on an opaque origin can never receive the identified
            // user, so the identify is refused without touching the session.
            if (hostOriginIsOpaque()) {
              setIdentityResolved(true)
              sendToHost({
                type: 'quackback:identify-result',
                success: false,
                error: 'HOST_ORIGIN_UNKNOWN',
              })
              break
            }
            sessionSourceRef.current = 'sdk'
            // Who the visitor is stays unknown until this round trip settles,
            // even if the frame had already settled as anonymous while it
            // waited for its host.
            setIdentityResolved(false)
            handleIdentify(msg.data as Record<string, unknown>)
            break
          case 'skip':
            // Portal session takes precedence — ack without changing state
            setIdentityResolved(true)
            sendToHost({
              type: 'quackback:identify-result',
              success: true,
              user: userRef.current,
            })
            sendToHost({ type: 'quackback:auth-change', user: userRef.current })
            break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    sendToHost({ type: 'quackback:ready' })

    return () => window.removeEventListener('message', handleMessage)
  }, [storeToken, applyIdentifyResult, setUser])

  const contextValue = useMemo(
    () => ({
      user,
      isIdentified,
      identityResolved,
      hmacRequired: hmacRequired ?? false,
      canPortalHandoff,
      ensureSession,
      ensureSessionThen,
      closeWidget,
      emitEvent,
      metadata: widgetMetadata,
      sessionVersion,
      getSessionVersion,
    }),
    [
      user,
      isIdentified,
      identityResolved,
      canPortalHandoff,
      ensureSession,
      ensureSessionThen,
      closeWidget,
      emitEvent,
      widgetMetadata,
      sessionVersion,
      getSessionVersion,
    ]
  )

  return (
    <IntlProvider
      locale={locale}
      messages={messages}
      defaultLocale={DEFAULT_LOCALE}
      onError={onIntlError}
    >
      <WidgetAuthContext.Provider value={contextValue}>{children}</WidgetAuthContext.Provider>
    </IntlProvider>
  )
}
