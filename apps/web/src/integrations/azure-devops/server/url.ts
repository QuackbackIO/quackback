/**
 * Organization name from an Azure DevOps URL: `https://dev.azure.com/{org}/...`
 * or the legacy `https://{org}.visualstudio.com/...`. Returns null for any
 * other host or when no organization is present. Compare case-insensitively.
 */
export function organizationFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.hostname === 'dev.azure.com') {
    return url.pathname.split('/').filter(Boolean)[0] ?? null
  }
  const suffix = '.visualstudio.com'
  if (url.hostname.endsWith(suffix) && url.hostname.length > suffix.length) {
    return url.hostname.slice(0, -suffix.length)
  }
  return null
}
