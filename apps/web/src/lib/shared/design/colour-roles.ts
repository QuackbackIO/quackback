/**
 * The brand's colours by role: the brand colour, the second colour and up to
 * two more. The band and a Home block's look can be drawn in any of them,
 * each with text that reads on it.
 */
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { clearerInk, contrastRatio, solveContrast } from './contrast'
import type { DESIGN_OPTIONS } from './options'
import type { PortalDesign } from './schema'

export type ColourRole = (typeof DESIGN_OPTIONS.colourRole)[number]
type Mode = 'light' | 'dark'
type TokenMap = Record<`--${string}`, string>

const NEAR_BLACK = 'oklch(0.145 0 0)'
const NEAR_WHITE = 'oklch(0.985 0 0)'

/**
 * Text that reads on every background given: the page's ink, then black or
 * white, then the ink moved in lightness; where text on the other side of
 * light reads too, and clearer, that instead. Null when none can.
 */
export function textOn(backgrounds: string[], t: Required<ThemeVariables>): string | null {
  const reads = (text: string) => backgrounds.every((bg) => contrastRatio(text, bg) >= 4.5)
  const inks = [t.foreground, t.background, NEAR_BLACK, NEAR_WHITE]
  const ink = inks.find(reads) ?? solveContrast(t.foreground, backgrounds, 4.5)
  return ink && clearerInk(ink, backgrounds, [...inks, '#000000', '#ffffff'])
}

/** A colour other than the brand colour, in a mode: dark keeps light's unless it sets its own. */
export function ownColour(doc: PortalDesign, mode: Mode, role: Exclude<ColourRole, 'accent'>) {
  const { light, dark } = doc.brand
  const pick = (palette: Partial<PortalDesign['brand']['light']> | undefined) =>
    role === 'support' ? palette?.support : palette?.extra?.[role === 'extra1' ? 0 : 1]
  return (mode === 'dark' ? pick(dark) : undefined) ?? pick(light)
}

/** The roles a design has a colour for, the brand colour first. */
export function designRoles(doc: PortalDesign): ColourRole[] {
  return (['accent', 'support', 'extra1', 'extra2'] as const).filter(
    (role) => role === 'accent' || !!ownColour(doc, 'light', role)
  )
}

/**
 * A role's colour in a mode and the text that reads on it. The brand colour
 * is the solved one; a role the design has no colour for is the brand colour.
 */
export function roleFill(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  mode: Mode,
  role: ColourRole | undefined
): { fill: string; ink: string } {
  const own = role && role !== 'accent' ? ownColour(doc, mode, role) : undefined
  if (!own) return { fill: t.primary, ink: t.primaryForeground }
  return { fill: own, ink: textOn([own], t) ?? NEAR_BLACK }
}

/** Each colour besides the brand's, with its text, for blocks drawn in it. */
export function roleTokens(doc: PortalDesign, t: Required<ThemeVariables>, mode: Mode): TokenMap {
  const out: TokenMap = {}
  for (const role of designRoles(doc)) {
    if (role === 'accent') continue
    const { fill, ink } = roleFill(doc, t, mode, role)
    out[`--qb-role-${role}`] = fill
    out[`--qb-on-role-${role}`] = ink
  }
  return out
}

/** Each role's name, as the controls call it. */
export const ROLE_NAMES: Record<ColourRole, string> = {
  accent: 'Brand colour',
  support: 'Second colour',
  extra1: 'Extra colour 1',
  extra2: 'Extra colour 2',
}

/** A colour role words may be drawn in: its name and its colour, as a swatch shows it. */
export interface WordsRole {
  role: ColourRole
  name: string
  colour: string
}

/** The colour roles a design has, for words: the brand colour first, each with its light colour. */
export function wordsRoles(doc: PortalDesign): WordsRole[] {
  return designRoles(doc).map((role) => ({
    role,
    name: ROLE_NAMES[role],
    colour: role === 'accent' ? doc.brand.light.accent : ownColour(doc, 'light', role)!,
  }))
}

/** A tint's name by the colour it is a tint of, such as "Tint of the brand colour". */
export const tintName = (role: ColourRole | undefined) =>
  !role || role === 'accent'
    ? 'Tint of the brand colour'
    : `Tint of ${ROLE_NAMES[role].toLowerCase()}`

/** The role a field picks, as drawn: the brand colour where the design has no colour for it. */
export function shownRole(doc: PortalDesign, role: ColourRole | undefined): ColourRole {
  return role && designRoles(doc).includes(role) ? role : 'accent'
}

/** A brand colour by name, to pick from or refer to. */
export interface BrandSwatch {
  name: string
  colour: string
}

/**
 * The brand's colours, each named by its role: the brand colour, the second
 * and the extras, the text and background, then the logo's own. A colour
 * that shows under one name is not repeated under another.
 */
export function brandSwatches(doc: PortalDesign): BrandSwatch[] {
  const { light, logoColours = [] } = doc.brand
  const named: Array<[string, string | undefined]> = [
    ...designRoles(doc).map((role): [string, string | undefined] => [
      ROLE_NAMES[role],
      role === 'accent' ? light.accent : ownColour(doc, 'light', role),
    ]),
    ['Text', light.ink],
    ['Background', light.background],
    ...logoColours.map((colour): [string, string] => ['Logo colour', colour]),
  ]
  const seen = new Set<string>()
  return named.flatMap(([name, colour]) => {
    const key = colour?.toLowerCase()
    if (!colour || !key || seen.has(key)) return []
    seen.add(key)
    return [{ name, colour }]
  })
}
