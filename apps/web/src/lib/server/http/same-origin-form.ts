/**
 * CSRF check for same-origin form POSTs.
 *
 * Compare the browser Origin host to the incoming Host. Do not compare
 * `new URL(request.url).origin`: TLS-terminating proxies present the app
 * URL as `http://`, while the browser always sends `Origin: https://…`.
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
  return originMatchesRequestHost(
    request.headers.get('origin'),
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  )
}
