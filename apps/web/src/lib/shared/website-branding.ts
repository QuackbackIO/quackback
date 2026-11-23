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
    return isStandardWebsiteUrl(url) && isPlainHostname(url.hostname) ? url : null
  } catch {
    return null
  }
}

/**
 * Letters, digits, dots, hyphens and underscores (or an address in brackets).
 * Some browsers keep a space or a quote in a host where the server refuses
 * it; a real host never has one, so both give the same answer.
 */
function isPlainHostname(hostname: string): boolean {
  return /^(?:[a-z\d._-]+|\[[\da-f:.]+\])$/i.test(hostname)
}
