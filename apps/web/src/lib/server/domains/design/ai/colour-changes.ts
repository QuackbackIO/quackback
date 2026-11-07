/**
 * T1 as design changes: the brand palette, what fills buttons and links, the
 * tints and the logo's colours. A brand match owns the palette, so what the
 * site gives no evidence for goes back to the default, never kept from a
 * brand matched before.
 */
import { colourVividness } from '@/lib/shared/design/palette'
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { hex as toHex, oklab, type RGB } from '../extract/color'
import type { ColourDesign } from '../extract/roles-design'
import type { ColourRoles } from '../extract/roles'
import { contrast, hexRgb } from '../extract/roles-places'
import type { BrandChange } from './brand-decide'

const change = (path: string, value: unknown, why: string): BrandChange => ({ path, value, why })

const lightness = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/**
 * A light site's text is the portal's ink where it is near black, or a grey
 * dark enough to set headlines in on a white page (a charcoal, about #404040
 * and darker). A softer grey leaves the default, and so does a dark colour
 * (a forest green, a navy): that is a headline's own colour, set there, and
 * the body text stays neutral.
 */
const INK_CONTRAST = 10
const LIGHT_PAGE = '#ffffff'
const neutral = (hex: string) => {
  const [, a, b] = oklab(hexRgb(hex))
  return Math.hypot(a, b) < HEADLINE_CHROMA
}

/** The palette a fresh design starts from, which a match falls back to where it measures nothing. */
const PALETTE_DEFAULT = defaultDesign().brand.light
const RESET = 'not seen on your site: the default, not the colour of a brand matched before'

/** T1: the brand palette, what fills buttons and links, the tints and the logo's colours. */
export function colourChanges(
  roles: ColourRoles,
  colour: ColourDesign,
  /** The draft's mode, so a light site turns a dark portal light and leaves a chosen mode alone. */
  current?: PortalDesign['mode']
): BrandChange[] {
  const { light, dark } = colour.brand
  const out: BrandChange[] = []
  // A dark site's portal is dark: the mode first, then dark mode's page, text and brand colour.
  if (colour.mode === 'dark' && dark) {
    out.push(
      change('mode', 'dark', `your site is dark: page ${roles.page}, text ${roles.text}`),
      change('brand.dark.background', dark.background, 'the page colour behind the content'),
      change('brand.dark.ink', dark.ink, 'the headline and body text colour'),
      change(
        'brand.dark.accent',
        dark.accent,
        dark.accent === roles.identity.value
          ? `brand colour: ${roles.identity.why}`
          : `brand colour, readable on the dark page: ${roles.identity.why}`
      )
    )
    for (const key of ['surface', 'raised', 'muted', 'border', 'support', 'extra'] as const)
      out.push(change(`brand.dark.${key}`, null, 'worked out from the measured palette'))
  } else {
    // A light site: a dark portal turns light again. Its dark mode is worked out from the
    // light palette, never kept from an earlier brand or the default's yellow.
    if (roles.scheme === 'light' && current === 'dark')
      out.push(change('mode', 'auto', 'your site is light'))
    out.push(change('brand.dark', null, 'worked out from the measured palette'))
  }
  out.push(
    change(
      'brand.light.accent',
      light.accent,
      light.accent === roles.identity.value
        ? `brand colour: ${roles.identity.why}`
        : `brand colour, readable on a light page: ${roles.identity.why}`
    )
  )
  // The page and text as measured, where the page is quiet enough to be a page.
  // A match owns the palette: what this site gives no evidence for goes back to the default,
  // never kept from a brand matched before.
  if (lightness(roles.page) > 0.8 && colourVividness(roles.page) <= 0.2)
    out.push(change('brand.light.background', roles.page, 'the page colour behind the content'))
  else out.push(change('brand.light.background', PALETTE_DEFAULT.background, RESET))
  if (
    lightness(roles.text) < 0.08 ||
    (neutral(roles.text) && contrast(roles.text, LIGHT_PAGE) >= INK_CONTRAST)
  )
    out.push(change('brand.light.ink', roles.text, 'the headline and body text colour'))
  else if (light.ink) out.push(change('brand.light.ink', light.ink, 'a monochrome site'))
  else out.push(change('brand.light.ink', PALETTE_DEFAULT.ink, RESET))
  // Surfaces a previous design set are worked out from the new palette again.
  for (const key of ['surface', 'raised', 'muted', 'border'] as const)
    out.push(change(`brand.light.${key}`, null, 'worked out from the measured palette'))
  out.push(
    light.support
      ? change('brand.light.support', light.support, `second colour: ${roles.highlight.why}`)
      : change('brand.light.support', null, `no second colour: ${roles.highlight.why}`)
  )
  out.push(
    light.extra?.length
      ? change('brand.light.extra', light.extra, 'further colours of the logo')
      : change('brand.light.extra', null, RESET)
  )
  out.push(
    colour.brand.logoColours?.length
      ? change('brand.logoColours', colour.brand.logoColours, 'the colours of the logo')
      : change('brand.logoColours', null, RESET)
  )
  out.push(statusMarkers(roles))
  if (colour.shape.fill) out.push(change('shape.fill', colour.shape.fill, roles.action.why))
  out.push(
    colour.shape.action
      ? change('shape.action', colour.shape.action, 'the main call to action is the second colour')
      : change('shape.action', null, 'the hero’s call to action as the other buttons')
  )
  out.push(
    colour.tune?.button
      ? change('tune.button.fill', colour.tune.button.fill, roles.action.why)
      : change('tune.button.fill', null, roles.action.why)
  )
  out.push(
    colour.tune?.button?.ink
      ? change('tune.button.ink', colour.tune.button.ink, 'readable on the button')
      : change('tune.button.ink', null, 'readable on the button')
  )
  out.push(
    colour.tune?.link
      ? change('tune.link.colour', colour.tune.link.colour, roles.links.why)
      : change('tune.link.colour', null, roles.links.why)
  )
  if (colour.layout.tint) out.push(change('layout.tint', colour.layout.tint, roles.tint.why))
  return out
}

/** Below this chroma a logo colour is grey; hues this far apart are different colours. */
const GREY = 0.03
const HUES_APART = 45

/** How many different colours a logo has: hues apart, greys and black left out. */
function logoHues(colours: readonly string[]): number {
  const hues: number[] = []
  for (const c of colours) {
    const o = parseOklch(hexToOklch(c))
    if (!o || o.c < GREY) continue
    const gap = (h: number) => {
      const d = Math.abs(h - o.h) % 360
      return d > 180 ? 360 - d : d
    }
    if (hues.every((h) => gap(h) >= HUES_APART)) hues.push(o.h)
  }
  return hues.length
}

/**
 * Status markers in the brand's own voice, as the approved goal designs set
 * them: a logo of several colours gives the statuses its colours (a chat app,
 * a furniture retailer, Harbor, Petal Post, Voltline); a monochrome brand draws them in its
 * ink rather than a rainbow; a brand of one colour keeps the coloured dots.
 */
export function statusMarkers(
  roles: Pick<ColourRoles, 'monochrome' | 'logoColours'> & Partial<Pick<ColourRoles, 'signature'>>
): BrandChange {
  if (roles.monochrome)
    return change('layout.status', 'ink', 'a monochrome brand: status markers in the text colour')
  if (roles.signature)
    return change(
      'layout.status',
      'ink',
      'a black and white brand with one accent: status markers in the text colour'
    )
  if (logoHues(roles.logoColours) >= 2)
    return change('layout.status', 'brand', 'your logo has several colours: status markers in them')
  return change(
    'layout.status',
    'colour',
    'one brand colour: status markers keep their own colours'
  )
}

/** A headline ink this colourful (OKLab chroma) and dark enough to read on a light page is its own colour. */
const HEADLINE_CHROMA = 0.04
const HEADLINE_DARK = 0.6

/**
 * A headline set in a colour of its own keeps it, in light mode: the approved
 * money transfer design sets its headline in the site's forest green and Harbor in its
 * deep green. Set even where the text shares it, as a headline on a band
 * otherwise takes the band's own black or white. A black, grey or white
 * headline, or a dark site's, sets none, so an earlier match's goes.
 */
export function headlineInkChanges(
  ink: RGB | readonly number[] | null | undefined,
  roles: Pick<ColourRoles, 'scheme'>
): BrandChange[] {
  const none = [change('tune.headline.colour', null, 'the headline in the text colour')]
  if (!ink || roles.scheme !== 'light') return none
  const [l, a, b] = oklab(ink as RGB)
  if (Math.hypot(a, b) < HEADLINE_CHROMA || l >= HEADLINE_DARK) return none
  const colour = toHex(ink.map(Math.round) as RGB)
  return [change('tune.headline.colour', colour, `your headline is set in ${colour}`)]
}
