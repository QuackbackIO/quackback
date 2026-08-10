import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'

export const DOCUMENT_CACHE_VARY =
  'Cookie, Authorization, Accept-Language, Sec-CH-Prefers-Color-Scheme, Host'

/**
 * Mark a credential-free public document response as shared-cacheable.
 * The presence of Cookie or Authorization makes the response private and
 * uncacheable, including malformed or denied credentials. The root bootstrap
 * consumes DOCUMENT_CACHE_VARY as defense in depth.
 *
 * Call from a route loader under an SSR-only guard, mirroring
 * setPortalFrameHeaders:
 *
 *   if (typeof window === 'undefined') await setPublicDocumentCacheHeaders()
 */
export const setPublicDocumentCacheHeaders = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = getRequestHeaders()
  if (headers.has('cookie') || headers.has('authorization')) {
    setResponseHeader('Cache-Control', 'private, no-store')
    return
  }

  setResponseHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600')
})
