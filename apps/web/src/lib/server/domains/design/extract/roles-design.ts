/**
 * Colour roles to design fields: a pure mapping from the five decisions to
 * the brand palette (accent, support, extras, logo colours), what fills the
 * main button and the band's call to action, the tints, the colour of a
 * solid band, and an intensity hint for the hero look and tints.
 *
 * The result is a partial design: the integration merges it into the draft
 * and validates it there.
 */
import type { ColourRoles } from './roles'
import { oklab } from './color'
import { chromaOf } from './colours'
import { contrast, hexRgb } from './roles-places'
import { LIGHT_TEXT } from './roles-tones'

export interface ColourDesign {
  /** A dark site's portal is dark; absent for a light site (the mode is left as it is). */
  mode?: 'dark'
  brand: {
    light: { accent: string; ink?: string; support?: string; extra?: string[] }
    /** A dark site's page, text and brand colour as dark mode shows them. */
    dark?: { background: string; ink: string; accent: string }
    logoColours?: string[]
  }
  shape: { fill?: 'accent' | 'ink'; action?: 'accent' | 'support' }
  layout: { tint?: 'neutral' | 'support'; bandColour?: 'accent' | 'support' | 'extra1' }
  tune?: { button?: { fill: string; ink?: string }; link?: { colour: string } }
  /** Not design fields: hints for the decisions made next (hero look, tints, follow-up offers). */
  hints: {
    /** How much of the interface the brand colour covers: quiet (under 1.5%), medium, bold (12% and more). */
    intensity: ColourRoles['intensity']
    coverage: number
    /** The hero look the evidence points to: a solid band in a role, a blend for a gradient, an image, or none. */
    heroLook: 'brand' | 'support' | 'blend' | 'image' | 'tint' | 'none'
    monochrome: boolean
  }
}

/** WCAG relative luminance of a hex colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

const readableOn = (hex: string) => (luminance(hex) > 0.4 ? '#111111' : '#ffffff')

/** OKLab chroma under which a dark page reads as a neutral ink (black, charcoal), not a colour. */
const INK_GREY = 0.02

/** Body text against its page. */
const TEXT_CONTRAST = 4.5
/** A brand colour against a page: buttons and links need 3:1 to be seen. */
const VISIBLE = 3
const LIGHT_PAGE = '#ffffff'
/** A dark portal's ink where the text read is not a light one. */
const DARK_MODE_INK = '#f5f5f5'

/**
 * Dark mode's ink: the text as read where it is light type that reads on the
 * page; a grey read (a caption, a field's placeholder) is not the headlines'
 * colour, nor is a dark ink taken off a light hero.
 */
const darkInkOf = (roles: ColourRoles, least: number) =>
  oklab(hexRgb(roles.text))[0] > LIGHT_TEXT && contrast(roles.text, roles.page) >= least
    ? roles.text
    : DARK_MODE_INK

/** Mixed toward white or black, in steps, until it reads on the page; the nearest that does. */
function visibleOn(hex: string, page: string): string {
  if (contrast(hex, page) >= VISIBLE) return hex
  const toward = luminance(page) > 0.18 ? [0, 0, 0] : [255, 255, 255]
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  for (let t = 0.05; t <= 1; t += 0.05) {
    const out =
      '#' +
      rgb
        .map((v, i) =>
          Math.round(v + (toward[i]! - v) * t)
            .toString(16)
            .padStart(2, '0')
        )
        .join('')
    if (contrast(out, page) >= VISIBLE) return out
  }
  return toward[0] ? '#ffffff' : '#000000'
}

/**
 * A brand colour for each mode's page. A genuine colour keeps its hue,
 * lightened or darkened only as far as it must be to read; a monochrome
 * brand's colour is its ink, so where the ink cannot read (white on a white
 * page) the other mode's ink stands in: never white on white.
 */
function accentsFor(roles: ColourRoles): { light: string; dark: string } {
  const accent = roles.identity.value
  if (!roles.monochrome)
    return { light: visibleOn(accent, LIGHT_PAGE), dark: visibleOn(accent, roles.page) }
  // The dark page is the ink only where it is a true near-black: a slate or navy page (often a
  // photo's backdrop read as the page) is a page colour, not the brand's ink.
  const lightInk =
    contrast(roles.page, LIGHT_PAGE) >= VISIBLE && chromaOf(oklab(hexRgb(roles.page))) < INK_GREY
      ? roles.page
      : '#111111'
  const darkInk = darkInkOf(roles, VISIBLE)
  return {
    light: contrast(accent, LIGHT_PAGE) >= VISIBLE ? accent : lightInk,
    dark: contrast(accent, roles.page) >= VISIBLE ? accent : darkInk,
  }
}

export function rolesToDesign(roles: ColourRoles): ColourDesign {
  const dark = roles.scheme === 'dark'
  const accents = dark ? accentsFor(roles) : null
  const accent = accents ? accents.light : roles.identity.value
  const support = roles.highlight.value ?? undefined
  const light: ColourDesign['brand']['light'] = { accent }
  // A dark site's text colour is light: it is dark mode's ink, never light mode's.
  if (roles.monochrome && !dark) light.ink = roles.text
  if (support) light.support = support
  if (roles.extras.length) light.extra = roles.extras.slice(0, 2)
  const out: ColourDesign = {
    brand: { light },
    shape: {},
    layout: {},
    hints: {
      intensity: roles.intensity,
      coverage: roles.coverage,
      heroLook: 'none',
      monochrome: roles.monochrome,
    },
  }
  if (roles.logoColours.length) out.brand.logoColours = roles.logoColours.slice(0, 6)
  if (accents) {
    out.mode = 'dark'
    // The text as read, where it is light type that reads on the page.
    const ink = darkInkOf(roles, TEXT_CONTRAST)
    out.brand.dark = { background: roles.page, ink, accent: accents.dark }
  }

  // The main button.
  const action = roles.action.value
  if (action.role === 'ink') out.shape.fill = 'ink'
  else out.shape.fill = 'accent'
  if (action.role === 'support' && support) out.shape.action = 'support'
  // A grey or second-colour button has no fill option of its own: its exact colour.
  // Exact colours are light mode's, so a dark site's are kept only where they read on a light page.
  const lightOnly = (hex: string) => !dark || contrast(hex, LIGHT_PAGE) >= VISIBLE
  if ((action.role === 'neutral' || action.role === 'support') && lightOnly(action.hex))
    out.tune = { button: { fill: action.hex, ink: readableOn(action.hex) } }

  // Links in the text colour (a light brand colour, or a monochrome site).
  if (roles.links.value.role === 'ink' && lightOnly(roles.links.value.hex))
    out.tune = { ...out.tune, link: { colour: roles.links.value.hex } }

  out.layout.tint = roles.tint.value

  // The hero: a solid band in the colour's role, a blend for a gradient, an image for a photo.
  const h = roles.hero
  if (h.look === 'solid' && h.role) {
    out.layout.bandColour = h.role
    out.hints.heroLook = h.role === 'support' ? 'support' : 'brand'
  } else if (h.look === 'gradient') out.hints.heroLook = support ? 'blend' : 'tint'
  else if (h.look === 'photo') out.hints.heroLook = 'image'
  else
    out.hints.heroLook =
      roles.intensity === 'bold' ? 'brand' : roles.intensity === 'medium' ? 'tint' : 'none'
  return out
}
