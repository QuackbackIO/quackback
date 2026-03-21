'use client'

import { useEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { authClient } from '@/lib/server/auth/client'

/**
 * Handles one-time token (OTT) session transfer from the widget to the portal.
 *
 * When a widget user clicks "View on feedback board", the widget generates a
 * one-time token and appends it as `?ott=<token>` to the portal URL. This
 * component detects the param, verifies the token (which sets the session cookie),
 * strips the param from the URL, and reloads to pick up the new session.
 */
export function OttHandler() {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })
  const processedRef = useRef<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(searchStr)
    const ott = params.get('ott')
    if (!ott || processedRef.current === ott) return
    processedRef.current = ott

    authClient.oneTimeToken.verify({ token: ott }).then(({ error }) => {
      params.delete('ott')
      const cleanSearch = params.toString()
      const cleanUrl = window.location.pathname + (cleanSearch ? `?${cleanSearch}` : '')

      if (error) {
        window.history.replaceState({}, '', cleanUrl)
        return
      }

      // Full reload to pick up the new session cookie in SSR
      window.location.replace(cleanUrl)
    })
  }, [searchStr])

  return null
}
