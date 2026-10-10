import { requestWorkspaceHost } from '@/lib/server/workspaces/saas-edge-host'

/**
 * CSRF check for same-origin form POSTs.
 *
 * Compare the browser Origin host to the visitor hostname. Do not compare
 * `new URL(request.url).origin`: TLS-terminating proxies present the app
 * URL as `http://`, while the browser always sends `Origin: https://…`.
 *
 * Custom-domain traffic is fetched by the saas-origin Worker against the
 * Railway origin, so Host / X-Forwarded-Host is the hop, not the browser
 * origin. The visitor name arrives as the signed customer-host header and
 * is recovered by `requestWorkspaceHost`.
 */

export function originMatchesRequestHost(
  origin: string | null,
  hostHeader: string | null
): boolean {
  if (!origin || !hostHeader) return false

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return false

  const host = hostHeader.split(',')[0]?.trim().toLowerCase()
  if (!host) return false
  return originUrl.host.toLowerCase() === host
}

export function isSameOriginFormPost(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (originMatchesRequestHost(origin, requestWorkspaceHost(request))) return true
  return originMatchesRequestHost(
    origin,
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  )
}
