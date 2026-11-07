/**
 * The brand's colours and fonts as the variables a field links to: each
 * named from the one name table (words.ts), with its colour in each mode
 * the design shows, or its face.
 */
import { BUNDLED_FONTS, fontStack } from '@/lib/shared/design/fonts'
import { resolveDesign } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { styleColourValue } from '@/lib/shared/design/style-css'
import { COLOUR_ROLES, type ColourRoleName } from '@/lib/shared/design/style-tokens'
import { designRoles } from '@/lib/shared/design/colour-roles'
import { oklchToHex } from '@/lib/shared/theme/colors'
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { COLOUR_NAMES, FONT_NAMES } from './words'

type DesignFont = PortalDesign['brand']['fonts']['body']

/** A brand colour a field can link to. */
export interface ColourToken {
  /** What the field stores: the role's name. */
  id: string
  name: string
  /** Its colour in light mode, as CSS; dark mode's where the design shows dark. */
  light: string
  dark?: string
}

/** A brand font a field can link to. */
export interface FontToken {
  id: keyof typeof FONT_NAMES
  name: string
  /** The face's own name: "Inter". */
  face: string
  /** Its CSS stack, to draw "Aa" in it. */
  stack: string
}

/** A colour as #rrggbb, for comparing; null for none. */
export function hexOf(colour: string): string | null {
  if (colour === 'transparent') return null
  if (/^#[0-9a-f]{6}$/i.test(colour)) return colour.toLowerCase()
  try {
    return oklchToHex(colour).toLowerCase()
  } catch {
    return null
  }
}

/**
 * The colour roles a design can link to, in the order given (every role by
 * default), each with its colour in each mode shown. Extra roles the brand
 * has no colour for are left out.
 */
export function colourTokens(
  design: PortalDesign,
  roles: readonly ColourRoleName[] = COLOUR_ROLES
): ColourToken[] {
  const resolved = resolveDesign(design)
  const has = designRoles(design)
  const at = (vars: ThemeVariables | null, mode: 'light' | 'dark', role: ColourRoleName) =>
    vars ? styleColourValue(role, design, vars as Required<ThemeVariables>, mode) : undefined
  return roles
    .filter(
      (role) =>
        !(['support', 'extra1', 'extra2'] as const).includes(role as 'support') ||
        has.includes(role as 'support')
    )
    .map((role) => {
      const light = at(resolved.light, 'light', role) ?? at(resolved.dark, 'dark', role)!
      const dark = at(resolved.dark, 'dark', role)
      return { id: role, name: COLOUR_NAMES[role], light, ...(dark ? { dark } : {}) }
    })
}

/** A face's own name: "Inter", or an uploaded family's. */
export const faceName = (font: DesignFont) =>
  font.kind === 'bundled' ? BUNDLED_FONTS[font.id].label : font.family

/** The brand's fonts: heading, headline (the heading's face unless it has its own) and body. */
export function fontTokens(design: PortalDesign): FontToken[] {
  const { heading, display, body } = design.brand.fonts
  const token = (id: FontToken['id'], font: DesignFont): FontToken => ({
    id,
    name: FONT_NAMES[id],
    face: faceName(font),
    stack: fontStack(font),
  })
  return [token('heading', heading), token('headline', display ?? heading), token('body', body)]
}
