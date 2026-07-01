'use client'

import { useEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'

/**
 * Fires an anonymous pageview beacon on portal route changes (visitor
 * analytics). Policy lives server-side: /api/track drops beacons whenever
 * visitor analytics is disabled, so this component only honors the browser's
 * opt-out signals, restricts itself to portal routes, and dedupes re-renders
 * of the same URL. It sends no identifier — the server derives everything.
 */
export function VisitorBeacon() {
  const href = useRouterState({ select: (s) => s.location.href })
  const isPortal = useRouterState({
    select: (s) => s.matches.some((m) => m.routeId.startsWith('/_portal')),
  })
  const lastTracked = useRef<string | null>(null)

  useEffect(() => {
    if (!isPortal || lastTracked.current === href) return
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
    if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return
    lastTracked.current = href

    const body = JSON.stringify({
      url: window.location.href,
      referrer: document.referrer,
      surface: 'portal',
    })
    if (!navigator.sendBeacon?.('/api/track', body)) {
      fetch('/api/track', { method: 'POST', body, keepalive: true }).catch(() => {})
    }
  }, [href, isPortal])

  return null
}
