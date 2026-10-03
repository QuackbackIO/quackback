export type AutomaticBrandingStatus = {
  domain: string
  pendingActionId: string | null
  status: 'pending' | 'applied' | 'undone' | 'skipped' | 'failed'
  canUndo: boolean
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
