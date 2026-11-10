/**
 * What the brand's site gave a match, stored and said: its images kept in
 * storage, and a line or two for the reply.
 */
import type { PortalDesign } from '@/lib/shared/design/schema'
import { logger } from '@/lib/server/logger'
import type { AppliedDesignChange } from '@/lib/shared/design/apply-changes'
import type { FoundLogo } from './brand-measure'
import {
  usable,
  cutInk,
  logoAgreement,
  siteLogoBytes,
  siteName,
  type FontResolution,
  type LogoAgreement,
} from './brand-site'
import type { SiteAsset, SiteRead } from '../site/types'

const log = logger.child({ module: 'brand-site' })

/** Stores an image from the brand's site (favicon, logo, share image), giving its key. */
export type SiteAssetStore = (
  bytes: Uint8Array,
  mime: SiteAsset['mime'],
  kind: 'favicon' | 'logo' | 'share'
) => Promise<string | null>

/** What the brand's site gave the match, for the reply and the builder. */
export interface SiteUse {
  host: string
  favicon: boolean
  shareImage: boolean
  /** The logo placed: the site's own file, the cut from the screenshot, or none. */
  logo: 'site' | 'cut' | null
  logoWhy: string | null
  fonts: { heading: FontResolution | null; body: FontResolution | null }
  /** Measured colours taken as the site's exact values. */
  snapped: string[]
  name: string | null
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The site's logo file, stored as the portal shows it. */
export async function storeSiteLogo(
  asset: SiteAsset,
  ink: string | null,
  store: SiteAssetStore
): Promise<string | null> {
  const bytes = siteLogoBytes(asset, ink)
  if (!bytes) return null
  try {
    return await store(bytes, asset.mime, 'logo')
  } catch (err) {
    log.warn({ err }, 'brand match could not store the site logo')
    return null
  }
}

/** The site's favicon and share picture, stored where the design has none. */
export async function storeSiteAssets(
  site: SiteRead | null,
  design: PortalDesign,
  store: SiteAssetStore | undefined
): Promise<{ favicon: string | null; shareImage: string | null }> {
  if (!site || !store) return { favicon: null, shareImage: null }
  const put = async (asset: SiteAsset | null, kind: 'favicon' | 'share') => {
    if (!asset) return null
    try {
      return await store(asset.bytes, asset.mime, kind)
    } catch (err) {
      log.warn({ err, kind }, 'brand match could not store a site image')
      return null
    }
  }
  const [favicon, shareImage] = await Promise.all([
    design.brand.favicon ? null : put(site.favicon, 'favicon'),
    design.brand.shareImage ? null : put(site.shareImage, 'share'),
  ])
  return { favicon, shareImage }
}

/** What the site gave, said in a line or two. */
export function siteNotes(use: SiteUse): string[] {
  const took = [
    use.logo === 'site' ? 'its logo file' : null,
    use.favicon ? 'its favicon' : null,
    use.shareImage ? 'its share picture' : null,
  ].filter((x): x is string => !!x)
  const fonts = [use.fonts.heading, use.fonts.body]
    .filter((f): f is FontResolution => !!f)
    .filter((f, i, all) => all.findIndex((g) => g.family === f.family) === i)
    .map((f) =>
      f.how === 'bundled' ? f.family : `${f.family} (drawn in the nearest bundled face)`
    )
  const notes: string[] = []
  if (took.length) notes.push(`From ${use.host}: ${took.join(', ')}.`)
  if (fonts.length) notes.push(`Fonts named by ${use.host}: ${fonts.join(', ')}.`)
  return notes
}

/**
 * The site's logo file, stored, where it is the logo the screenshot shows
 * (a social banner never is); null, and why, where it is not.
 */
export async function siteLogoFor(
  site: SiteRead,
  cut: FoundLogo,
  store: SiteAssetStore
): Promise<{ agreement: LogoAgreement | null; siteLogo: string | null }> {
  const asset = site.logo
  if (!asset || asset.from === 'og-image') return { agreement: null, siteLogo: null }
  const agreement = logoAgreement(cut, asset)
  const siteLogo = agreement.agrees ? await storeSiteLogo(asset, cutInk(cut), store) : null
  return { agreement, siteLogo }
}

/** What the site gave, as the result reports it. */
export function siteUseOf(
  site: SiteRead & { facts: NonNullable<SiteRead['facts']> },
  applied: readonly AppliedDesignChange[],
  parts: Pick<SiteUse, 'logo' | 'logoWhy' | 'fonts' | 'snapped'>
): SiteUse {
  return {
    host: hostOf(site.facts.url),
    favicon: applied.some((c) => c.path === 'brand.favicon'),
    shareImage: applied.some((c) => c.path === 'brand.shareImage'),
    ...parts,
    name: siteName(site.facts),
  }
}

/**
 * The site read, waited for up to `ms` (it runs beside the finder, so it is
 * usually in); null when it is late, failed, or met a bot wall.
 */
export async function siteWithin(
  site: SiteRead | Promise<SiteRead | null> | null | undefined,
  ms: number
): Promise<(SiteRead & { facts: NonNullable<SiteRead['facts']> }) | null> {
  if (!site) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const read = await Promise.race([
      Promise.resolve(site),
      new Promise<null>((done) => {
        timer = setTimeout(() => done(null), ms)
      }),
    ])
    return usable(read) ? read : null
  } catch (err) {
    log.warn({ err }, 'brand match: the site read failed')
    return null
  } finally {
    clearTimeout(timer)
  }
}
