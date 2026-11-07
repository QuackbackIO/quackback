/**
 * The portal's logo: an icon and a title, the title in the theme's heading
 * font. A full logo image takes their place where a design asks for one.
 * Designs stored before the logo was an icon and a title may show the icon
 * alone or the title alone; setting either brings both back into view.
 */
import type { PortalDesign } from './schema'

type Logo = PortalDesign['brand']['logo']
type Ink = NonNullable<Logo['tone']>

/** A design that showed only its icon or only its title shows both. */
function showBoth(logo: Logo) {
  if (logo.display === 'mark' || logo.display === 'name') logo.display = 'mark_and_name'
}

/**
 * A new logo image's ink, measured, or none. Whether it is one ink is not
 * measured for an uploaded image, so an earlier logo's is forgotten: the
 * new one keeps its colours where it would vanish, only its vanishing ink turned over.
 */
export function setLogoInk(logo: Logo, ink: Ink | null) {
  if (ink) logo.tone = ink
  else delete logo.tone
  delete logo.oneInk
  delete logo.ink
}

/** The icon, with its ink where it was measured; null removes it. */
export function setIcon(design: PortalDesign, icon: { key: string } | null, ink: Ink | null) {
  const { logo } = design.brand
  logo.mark.light = icon
  if (logo.display === 'wordmark') return
  showBoth(logo)
  setLogoInk(logo, icon ? ink : null)
}

/** The title beside the icon; empty goes back to the workspace's name. */
export function setTitle(design: PortalDesign, title: string) {
  const { logo } = design.brand
  if (title.trim()) logo.name = title
  else delete logo.name
  showBoth(logo)
}

/** A full logo image in place of the icon and title, or back to them. */
export function showFullLogo(design: PortalDesign, on: boolean) {
  design.brand.logo.display = on ? 'wordmark' : 'mark_and_name'
}

/** At least this share of an image clear, for its own background not to count. */
const CLEAR_SHARE = 0.1
/** Relative luminance below this reads as a dark ink, above the other as light. */
const DARK_INK = 0.2
const LIGHT_INK = 0.7

const linear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Relative luminance under which ink is below 3:1 on a near-black header: it vanishes there. */
const VANISHES_ON_DARK = 0.11
/** From this share of a logo's ink vanishing on a dark header, its ink counts as dark. */
const DARK_SHARE = 0.3

/**
 * Whether a logo image's ink is dark or light, from its RGBA pixels, so the
 * header can redraw it where it would vanish. Dark or light throughout, or,
 * beside brighter colours, dark where much of it (a black name beside a
 * coloured mark) would vanish on a dark header. An image with little clear
 * area carries its own background and is left as it is; a logo of mid
 * colours reads on most headers.
 */
export function logoInk(data: Uint8ClampedArray): Ink | null {
  let clear = 0
  let opaque = 0
  let luminance = 0
  let darkInk = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 128) {
      clear++
      continue
    }
    opaque++
    const y =
      0.2126 * linear(data[i]!) + 0.7152 * linear(data[i + 1]!) + 0.0722 * linear(data[i + 2]!)
    luminance += y
    if (y < VANISHES_ON_DARK) darkInk++
  }
  if (!opaque || clear / (clear + opaque) < CLEAR_SHARE) return null
  const mean = luminance / opaque
  if (mean < DARK_INK) return 'dark'
  if (mean > LIGHT_INK) return 'light'
  return darkInk / opaque >= DARK_SHARE ? 'dark' : null
}

/**
 * The header's ways of drawing a logo image whose ink would vanish into it,
 * as SVG filters the header defines once:
 * - reverse: a logo of one ink, its lightness turned over with its colour
 *   kept, as a brand's reversed logo is: black reads white, a white face in a
 *   black mark turns dark, a coloured ink keeps its hue;
 * - lift: a logo of several colours on a dark header, only its dark ink made
 *   light (in its own hue), its brighter colours kept as they are;
 * - sink: the same on a light header, only its light ink made dark;
 * - ink: a logo of one ink on a header of its own colour, drawn in the
 *   header's text colour, as a brand's one-colour logo is on its own colour.
 */
export const LOGO_FILTER = {
  reverse: 'qb-logo-reverse',
  lift: 'qb-logo-lift',
  sink: 'qb-logo-sink',
  ink: 'qb-logo-ink',
} as const
