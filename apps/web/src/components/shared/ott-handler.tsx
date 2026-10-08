'use client'

import { useEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { widgetHandoffPath } from '@/lib/shared/routing'

/**
 * Forwards leftover `?ott=` on portal pages to `/auth/widget-handoff`.
 * That route owns cookie install (and the teammate skip). Do not verify here.
 */
export function isPortalOttPath(pathname: string): boolean {
  return !pathname.startsWith('/auth/')
}

/** Build the widget-handoff URL for a portal page that still has `?ott=`. */
export function portalOttForwardUrl(pathname: string, searchStr: string): string | null {
  if (!isPortalOttPath(pathname)) return null
  const raw = searchStr.startsWith('?') ? searchStr.slice(1) : searchStr
  const params = new URLSearchParams(raw)
  const ott = params.get('ott')
  if (!ott) return null
  params.delete('ott')
  const cleanSearch = params.toString()
  const returnTo = pathname + (cleanSearch ? `?${cleanSearch}` : '')
  return widgetHandoffPath(ott, returnTo)
}

export function OttHandler() {
  // Selects the forward itself, so a navigation without `?ott=` renders nothing.
  const next = useRouterState({
    select: (s) => portalOttForwardUrl(s.location.pathname, s.location.searchStr),
  })
  const processedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!next || processedRef.current === next) return
    processedRef.current = next
    window.location.replace(next)
  }, [next])

  return null
}
