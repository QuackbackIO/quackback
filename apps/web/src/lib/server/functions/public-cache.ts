import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'

/**
 * Mark a public document response as shared-cacheable when the request
 * carries no cookies (anonymous visitors and crawlers). Cookie-bearing
 * requests stay uncached so personalized SSR is never served from a shared
 * cache; the root bootstrap already emits the matching `Vary` set
 * (Cookie, Accept-Language, Sec-CH-Prefers-Color-Scheme, Host).
 *
 * Call from a route loader under an SSR-only guard, mirroring
 * setPortalFrameHeaders:
 *
 *   if (typeof window === 'undefined') await setPublicDocumentCacheHeaders()
 */
export const setPublicDocumentCacheHeaders = createServerFn({ method: 'GET' }).handler(async () => {
  if (getRequestHeaders().get('cookie')) return
  setResponseHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600')
})
