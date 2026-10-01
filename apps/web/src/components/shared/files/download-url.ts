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
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}download=1&filename=${encodeURIComponent(name)}`
}
