/**
 * Appends query params to a URL, extending its existing query string if it
 * has one, and keeps a URL fragment (`#...`) last so it still points at the
 * right place in the document instead of being read as part of the query.
 */
export function withQueryParams(url: string, params: Record<string, string>): string {
  const hashAt = url.indexOf('#')
  const base = hashAt === -1 ? url : url.slice(0, hashAt)
  const fragment = hashAt === -1 ? '' : url.slice(hashAt)
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}${query}${fragment}`
}

/**
 * A stored file's link as a download under its own name.
 *
 * `download=1` makes the storage route answer with `Content-Disposition:
 * attachment` and the original name (UTF-8), on the proxy and the redirect
 * paths alike. The `download` attribute on a link is ignored across origins,
 * so the header is what makes Download behave the same for every format and
 * wherever files are served from.
 */
export function downloadUrl(url: string, name: string): string {
  return withQueryParams(url, { download: '1', filename: name })
}
