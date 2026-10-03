import { parseOpenGraph } from './og-parse'
import { fetchFollowingRedirects, rehostImageFromUrl } from './unfurl'
import { safeWebsiteBrandColor } from '@/lib/shared/website-brand-color'

export interface WebsiteBranding {
  domain: string
  logoKey: string
  logoUrl: string
  color: string | null
}

/** Fetch the homepage through the safe unfurl path and store a verified logo. */
export async function fetchWebsiteBranding(site: string): Promise<WebsiteBranding | null> {
  try {
    if (!site.trim()) return null
    const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(site) ? site : 'https://' + site)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      return null
    const fetched = await fetchFollowingRedirects(parsed.origin + '/')
    if (
      !fetched?.response.ok ||
      !fetched.response.headers.get('content-type')?.toLowerCase().startsWith('text/html')
    )
      return null
    const metadata = parseOpenGraph(await fetched.response.text(), fetched.finalUrl)
    const candidates = [
      ...new Set(
        [
          metadata.faviconUrl,
          new URL('/favicon.ico', fetched.finalUrl).href,
          metadata.imageUrl,
        ].filter((url): url is string => Boolean(url))
      ),
    ]
    for (const candidate of candidates) {
      const logo = await rehostImageFromUrl(candidate, {
        timeoutMs: 10_000,
        maxBytes: 5 * 1024 * 1024,
        storagePrefix: 'logos',
        followRedirects: true,
      })
      if (logo)
        return {
          domain: parsed.hostname.toLowerCase(),
          logoKey: logo.key,
          logoUrl: logo.url,
          color: safeWebsiteBrandColor(metadata.themeColor),
        }
    }
    return null
  } catch {
    return null
  }
}
