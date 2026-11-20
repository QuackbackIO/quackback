/**
 * The static reader: the site's HTML and stylesheets, read without running
 * anything (site/site-read.ts), as a `BrandRead`. It names the theme colour,
 * fonts, colour candidates and logo; page and text colours and corner radii
 * need a rendered page, so it leaves those out.
 */
import type { BrandRead, Hex } from '@/lib/shared/theme/brand-import'
import type { BrandReader } from './readers'
import { readSite } from './site/site-read'
import { brandThemeColour } from './site/theme-colour'
import type { PageStyle } from './site/site-style'
import type { FontFact, SiteAsset, SiteFetcher, SiteRead } from './site/types'

const fontOf = (fact: FontFact | null) =>
  fact ? { family: fact.family, stack: fact.stack.join(', ') } : undefined

/** Logo image types storage accepts. An ICO is never offered as a logo. */
const LOGO_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

function logoOf(asset: SiteAsset, from: NonNullable<BrandRead['logo']>['from']): BrandRead['logo'] {
  const size = { widthPx: asset.width, heightPx: asset.height }
  if (asset.mime === 'image/svg+xml') {
    // The reader sanitised it already; the bytes are its markup.
    return { svg: new TextDecoder().decode(asset.bytes), ...size, from }
  }
  if (!LOGO_MIMES.has(asset.mime)) return undefined
  return { raster: { bytes: asset.bytes, mime: asset.mime }, ...size, from }
}

/**
 * The header logo, else a declared one. A share image is never a logo, and
 * neither is the favicon: the icon is read on its own (siteIcon).
 */
function siteLogo(site: SiteRead): BrandRead['logo'] {
  const logo = site.logo
  if (!logo || logo.from === 'og-image') return undefined
  return logoOf(logo, logo.from === 'header-svg' ? 'header-svg' : 'header-img')
}

/** The site's app icon, already checked square and large enough (site/app-icon.ts). */
function siteIcon(site: SiteRead): BrandRead['icon'] {
  const icon = site.icon
  if (!icon || !LOGO_MIMES.has(icon.mime)) return undefined
  return {
    raster: { bytes: icon.bytes, mime: icon.mime },
    widthPx: icon.width,
    heightPx: icon.height,
  }
}

/** The page colours and shapes the stylesheets give. */
function styleOf(style: PageStyle | null): Pick<BrandRead, 'page' | 'button' | 'card'> {
  if (!style) return {}
  const page =
    style.background || style.text
      ? {
          ...(style.background ? { background: style.background as Hex | 'transparent' } : {}),
          ...(style.text ? { text: style.text as Hex } : {}),
        }
      : undefined
  const button: BrandRead['button'] = style.button
    ? { ...style.button, fill: style.button.fill as Hex | undefined }
    : undefined
  const card = style.cardRadiusPx !== null ? { radiusPx: style.cardRadiusPx } : undefined
  return { page, button, card }
}

export function brandReadFromSite(site: SiteRead): BrandRead {
  const facts = site.facts
  if (!facts) return {}
  const total = facts.colours.reduce((sum, colour) => sum + colour.weight, 0)
  const read: BrandRead = {
    // The whole title when the reader kept it; else the name it worked out of it.
    title: facts.title ?? facts.name ?? undefined,
    names: facts.declaredNames?.length ? facts.declaredNames : undefined,
    nameWritten: facts.nameWritten ?? undefined,
    // Only a name the site declares: one worked out of its title stays the title.
    siteName:
      (facts.nameFrom === 'og:site_name' ? facts.name : facts.organisationName) ?? undefined,
    themeColor: brandThemeColour(facts.themeColour, { otherColours: facts.colours.length > 0 }),
    fonts:
      facts.fonts.body || facts.fonts.heading
        ? { body: fontOf(facts.fonts.body), headline: fontOf(facts.fonts.heading) }
        : undefined,
    palette: total
      ? facts.colours.map((colour) => ({
          hex: colour.hex as Hex,
          share: Math.round((colour.weight / total) * 1000) / 1000,
        }))
      : undefined,
    logo: siteLogo(site),
    localVersions: facts.localVersions.length > 0 ? facts.localVersions : undefined,
    icon: siteIcon(site),
    ...styleOf(facts.style),
  }
  return Object.fromEntries(
    Object.entries(read).filter(([, value]) => value !== undefined)
  ) as BrandRead
}

/** The static reader over `fetcher` (live, or a recorded one in tests). */
export function staticBrandReader(fetcher: SiteFetcher): BrandReader {
  return {
    name: 'static',
    async read(url) {
      const site = await readSite(url, fetcher)
      if (site.failed === 'challenge') return { failed: 'challenge' }
      if (site.failed === 'error_page') return { failed: 'error' }
      if (site.failed === 'picker')
        return {
          failed: 'picker',
          links: site.links ?? [],
          pageUrl: site.facts?.url ?? url,
          localVersions: site.facts?.localVersions.length ? site.facts.localVersions : undefined,
        }
      if (site.failed || !site.facts) return { failed: 'unreachable' }
      return { read: brandReadFromSite(site) }
    },
  }
}
