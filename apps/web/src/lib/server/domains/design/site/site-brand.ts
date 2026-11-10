/**
 * Use from your website, for a workspace without Quackback AI: the brand's
 * site read from its code (no model, no capture), and what it gives stored
 * and offered for the person to check: its logo file, favicon, share image
 * and one brand colour. Font names are left out: a site's code names them
 * too unreliably to offer unchecked. Refusals are values, never throws.
 */
import { logger } from '@/lib/server/logger'
import type { SiteBrandOffer } from '@/lib/shared/design/site-brand'
import { isFullLogo } from '../ai/brand-site-match'
import { storeSiteLogo, type SiteAssetStore } from '../ai/brand-site-use'
import { siteName } from '../ai/brand-site-words'
import { siteHost } from './host'
import type { SiteAsset, SiteFacts, SiteRead } from './types'

const log = logger.child({ module: 'site-brand' })

export type SiteBrandResult =
  | { ok: true; offer: SiteBrandOffer }
  | { ok: false; code: 'INVALID_URL' | 'SITE_UNREADABLE' | 'NOTHING_FOUND'; message: string }

const channels = (hex: string) =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ]

/** Whether a colour is a colour: not a grey, nor so dark or light it reads as one. */
function chromatic(hex: string): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return false
  const [r, g, b] = channels(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  return max - min >= 0.15 && lightness > 0.08 && lightness < 0.92
}

/**
 * The one colour offered as the brand colour: the most strongly named
 * (a brand or primary property first, then an accent or a button, then the
 * theme-color), skipping greys. None when the site names no colour.
 */
export function brandColourOf(facts: SiteFacts): string | null {
  const named = [...facts.colours].sort((a, b) => b.weight - a.weight).map((c) => c.hex)
  const found = [...named, ...(facts.themeColour ? [facts.themeColour] : [])].find(chromatic)
  return found ? found.toLowerCase() : null
}

async function stored(
  asset: SiteAsset | null,
  kind: 'favicon' | 'share',
  store: SiteAssetStore
): Promise<{ key: string } | null> {
  if (!asset) return null
  try {
    const key = await store(asset.bytes, asset.mime, kind)
    return key ? { key } : null
  } catch (err) {
    log.warn({ err, kind }, 'could not store a site image')
    return null
  }
}

export async function readSiteBrand(
  input: string,
  deps: {
    read?: (url: string) => Promise<SiteRead>
    store?: SiteAssetStore
  } = {}
): Promise<SiteBrandResult> {
  const site = siteHost(input)
  if (!site)
    return {
      ok: false,
      code: 'INVALID_URL',
      message: 'That is not a public website.',
    }
  const read =
    deps.read ??
    (async (url: string) => {
      const { readSite, liveSiteFetcher } = await import('./site-read')
      return readSite(url, liveSiteFetcher)
    })
  const store = deps.store ?? (await import('../ai/brand-calls')).storeAsset
  const found = await read(site.url)
  if (!found.facts) {
    log.info({ host: site.host, failed: found.failed }, 'site brand: site unreadable')
    return { ok: false, code: 'SITE_UNREADABLE', message: 'That website could not be read.' }
  }
  // A logo the site names as its own; a social banner never is one.
  const logoAsset = found.logo && found.logo.from !== 'og-image' ? found.logo : null
  const [logoKey, favicon, shareImage] = await Promise.all([
    logoAsset ? storeSiteLogo(logoAsset, null, store) : null,
    stored(found.favicon, 'favicon', store),
    stored(found.shareImage, 'share', store),
  ])
  const offer: SiteBrandOffer = {
    host: site.host,
    name: siteName(found.facts),
    logo: logoKey && logoAsset ? { key: logoKey, full: isFullLogo(logoAsset) } : null,
    favicon,
    shareImage,
    colour: brandColourOf(found.facts),
  }
  log.info(
    {
      host: site.host,
      logo: !!offer.logo,
      favicon: !!favicon,
      shareImage: !!shareImage,
      colour: !!offer.colour,
    },
    'site brand read'
  )
  if (!offer.logo && !favicon && !shareImage && !offer.colour)
    return {
      ok: false,
      code: 'NOTHING_FOUND',
      message: `Nothing to use was found on ${site.host}.`,
    }
  return { ok: true, offer }
}
