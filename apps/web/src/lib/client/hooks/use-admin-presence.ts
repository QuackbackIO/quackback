import { useEffect, useState } from 'react'
import { useConversationStream } from './use-conversation-stream'

/** The query flag an e2e test adds to an admin URL to keep presence on. */
export const E2E_PRESENCE_QUERY_FLAG = 'e2e-presence'
const E2E_PRESENCE_STORAGE_KEY = 'quackback:e2e-presence'

/**
 * Did this tab ask for presence under automation? The flag is read from the
 * URL once and remembered for the tab, so client-side navigation and reloads
 * inside the admin keep it.
 */
export function hasE2ePresenceFlag(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).get(E2E_PRESENCE_QUERY_FLAG) === '1') {
      window.sessionStorage.setItem(E2E_PRESENCE_STORAGE_KEY, '1')
      return true
    }
    return window.sessionStorage.getItem(E2E_PRESENCE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Keep a team member marked "online" for conversation routing on ANY admin page (not
 * just the Conversations inbox), via a presence-only SSE that carries no conversation
 * events. The agent stays online for the whole admin session; offline re-queue
 * only fires when they leave the admin entirely. Pass enabled=false to skip it
 * (public routes, or when the support inbox feature is off).
 */
export function useAdminPresence(enabled: boolean): void {
  // An automated browser (navigator.webdriver — Playwright/Selenium/etc.) must
  // not mark the agent online: a headless health check or e2e run holding an
  // admin session would otherwise flip presence and pull conversation routing
  // toward a bot. It also means the app-wide SSE doesn't pin the network open
  // under test runners (Playwright's networkidle would never settle).
  const automated = typeof navigator !== 'undefined' && navigator.webdriver === true

  // The one exception: an e2e test that tests presence adds ?e2e-presence=1,
  // and the server confirms the e2e harness is on (a 404 everywhere else, so
  // the flag does nothing on a real deployment).
  const [e2ePresenceAllowed, setE2ePresenceAllowed] = useState(false)
  useEffect(() => {
    if (!enabled || !automated || !hasE2ePresenceFlag()) return
    let cancelled = false
    fetch('/api/e2e/presence', { cache: 'no-store', credentials: 'same-origin' })
      .then((res) => {
        if (!cancelled && res.status === 204) setE2ePresenceAllowed(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [enabled, automated])

  useConversationStream({
    enabled: enabled && (!automated || e2ePresenceAllowed),
    buildUrl: async () => '/api/chat/stream?scope=presence',
    onEvent: () => {},
  })
}
