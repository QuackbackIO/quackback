/**
 * What a website says about its brand, for Quackback AI's directions: its
 * name, its description and the colour it asks browsers to use. Fetched with
 * the same safe fetch the logo lookup uses, and nothing is stored.
 */
import { parseOpenGraph } from '@/lib/server/content/og-parse'
import { fetchFollowingRedirects } from '@/lib/server/content/unfurl'
import { safeWebsiteBrandColor } from '@/lib/shared/website-brand-color'
import { isStandardWebsiteUrl, parseWebsiteInput } from '@/lib/shared/website-branding'
import { normaliseColor } from '@/lib/shared/design/color'

export interface SiteSignals {
  domain: string
  title: string | null
  description: string | null
  /** The site's theme colour, when it sets a usable one. */
  colour: string | null
}

export async function readSiteSignals(site: string): Promise<SiteSignals | null> {
  const parsed = parseWebsiteInput(site)
  if (!parsed) return null
  try {
    const fetched = await fetchFollowingRedirects(parsed.origin + '/', {
      allowUrl: isStandardWebsiteUrl,
    })
    if (
      !fetched?.response.ok ||
      !fetched.response.headers.get('content-type')?.toLowerCase().startsWith('text/html')
    )
      return null
    const metadata = parseOpenGraph(await fetched.response.text(), fetched.finalUrl)
    const colour = safeWebsiteBrandColor(metadata.themeColor)
    return {
      domain: parsed.hostname.toLowerCase(),
      title: metadata.title?.slice(0, 120) ?? null,
      description: metadata.description?.slice(0, 300) ?? null,
      colour: colour ? normaliseColor(colour) : null,
    }
  } catch {
    return null
  }
}
