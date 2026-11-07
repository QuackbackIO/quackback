/**
 * Use from your website: what a brand's site gave without a model (its logo
 * file, favicon, share image and one brand colour, already stored), and how
 * the parts the person checks go into the design. Font names are never
 * offered: a site's code names them too unreliably to use unchecked.
 */
import { setIcon, setTitle, showFullLogo } from './logo'
import type { PortalDesign } from './schema'

export interface SiteBrandOffer {
  host: string
  /** The name the site gives itself, for a title the design does not have yet. */
  name: string | null
  /** Stored; `full` when wide enough to be a full logo with the name in it. */
  logo: { key: string; full: boolean } | null
  favicon: { key: string } | null
  shareImage: { key: string } | null
  /** One brand colour, #rrggbb. */
  colour: string | null
}

export type SiteBrandPick = 'logo' | 'favicon' | 'shareImage' | 'colour'

const ORDER: readonly SiteBrandPick[] = ['logo', 'favicon', 'shareImage', 'colour']

/** What the site gave, in the order it is offered. */
export function offeredPicks(offer: SiteBrandOffer): SiteBrandPick[] {
  return ORDER.filter((pick) => offer[pick] !== null)
}

/**
 * The checked parts into the design, as one change, recording that a match
 * ran (brand.matchedAt). Nothing checked changes nothing.
 */
export function applySiteBrand(
  design: PortalDesign,
  offer: SiteBrandOffer,
  picks: ReadonlySet<SiteBrandPick>,
  at: Date
): void {
  const used = offeredPicks(offer).filter((pick) => picks.has(pick))
  if (!used.length) return
  const { brand } = design
  if (used.includes('logo') && offer.logo) {
    if (offer.logo.full) {
      brand.logo.wordmark.light = { key: offer.logo.key }
      showFullLogo(design, true)
    } else {
      showFullLogo(design, false)
      setIcon(design, { key: offer.logo.key }, null)
      if (offer.name && !brand.logo.name) setTitle(design, offer.name)
    }
  }
  if (used.includes('favicon') && offer.favicon) brand.favicon = { key: offer.favicon.key }
  if (used.includes('shareImage') && offer.shareImage)
    brand.shareImage = { key: offer.shareImage.key }
  if (used.includes('colour') && offer.colour) brand.light.accent = offer.colour
  brand.matchedAt = at.toISOString()
}
