/**
 * Automatic website branding as Home sees it.
 *
 * - `eligible`: no lookup has run and this teammate may start one.
 * - `pending`: a lookup is fetching the website.
 * - `offered`: a weak logo waits for "Use it" or "Not now".
 * - `applied`: the logo (and maybe the color) changed, with Undo.
 * - the rest are quiet end states.
 */
export type AutomaticBrandingStatus = {
  domain: string
  status:
    'eligible' | 'pending' | 'offered' | 'applied' | 'declined' | 'undone' | 'skipped' | 'failed'
  /** The stored logo for a thumbnail, while offered or applied. */
  logoUrl: string | null
  /** Whether the applied change also set the brand color. */
  colorApplied: boolean
  /** Undo for an applied change. */
  canUndo: boolean
  /** "Use it" and "Not now" for an offered logo. */
  canUse: boolean
}

/** Website branding fetches use only the standard web ports and never carry credentials. */
export function isStandardWebsiteUrl(url: URL): boolean {
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    (url.port === '' || url.port === '80' || url.port === '443') &&
    !url.username &&
    !url.password
  )
}

/** A website typed as a domain or a URL, or null when it cannot be fetched for branding. */
export function parseWebsiteInput(site: string): URL | null {
  const value = site.trim()
  if (!value) return null
  try {
    // `host:443` is a host and port; `name:` followed by anything else is a scheme.
    const url = new URL(/^[a-z][a-z\d+.-]*:(?!\d)/i.test(value) ? value : `https://${value}`)
    return isStandardWebsiteUrl(url) ? url : null
  } catch {
    return null
  }
}
