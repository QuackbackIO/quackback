'use client'

import { useEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'

/**
 * Fires an anonymous pageview beacon on portal route changes (visitor
 * analytics). Honors the browser's opt-out signals,
 * restricts itself to portal routes, and dedupes re-renders of the same
 * URL. It sends no identifier — the server derives everything.
 */
const DEVICE_COOKIE = 'qb_device'

/** First-party durable device id (layer-2 identity, instance-opt-in). */
function getOrCreateDeviceId(): string | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${DEVICE_COOKIE}=([^;]+)`))
    if (match) return match[1]
    const id = crypto.randomUUID()
    document.cookie = `${DEVICE_COOKIE}=${id}; Max-Age=31536000; Path=/; SameSite=Lax`
    return id
  } catch {
    return null
  }
}

export function VisitorBeacon() {
  // The URL to track, or null off the public visitor-facing surfaces (the
  // portal tree plus the standalone changelog and help-center trees, the
  // latter also serving the subdomain), so a navigation elsewhere renders
  // nothing.
  const href = useRouterState({
    select: (s) =>
      s.matches.some((m) =>
        ['/_portal', '/changelog', '/hc', '/help'].some((prefix) => m.routeId.startsWith(prefix))
      )
        ? s.location.href
        : null,
  })
  const lastTracked = useRef<string | null>(null)

  useEffect(() => {
    if (!href || lastTracked.current === href) return
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
    if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return
    lastTracked.current = href

    const deviceId = getOrCreateDeviceId()
    const body = JSON.stringify({
      url: window.location.href,
      referrer: document.referrer,
      surface: 'portal',
      ...(deviceId ? { deviceId } : {}),
    })
    if (!navigator.sendBeacon?.('/api/track', body)) {
      fetch('/api/track', { method: 'POST', body, keepalive: true }).catch(() => {})
    }
  }, [href])

  return null
}
