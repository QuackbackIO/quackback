/**
 * Whether a design carries the brand, for the launch plan's branding step: a
 * brand match has run, or the Brand kit has an icon, a brand colour and a
 * font of its own. A logo alone, as onboarding used to leave it, is not a brand.
 */
import { normaliseColor } from './color'
import { defaultDesign, type PortalDesign } from './schema'

const DEFAULT = defaultDesign().brand

type Font = PortalDesign['brand']['fonts']['body']

const sameFont = (a: Font, b: Font) => JSON.stringify(a) === JSON.stringify(b)
const colourOf = (value: string) => normaliseColor(value) ?? value

export function brandIsSet(design: PortalDesign): boolean {
  const { brand } = design
  if (brand.matchedAt) return true
  const icon = !!(brand.logo.mark.light ?? brand.logo.mark.dark)
  const colour = colourOf(brand.light.accent) !== colourOf(DEFAULT.light.accent)
  const font =
    !sameFont(brand.fonts.heading, DEFAULT.fonts.heading) ||
    !sameFont(brand.fonts.body, DEFAULT.fonts.body)
  return icon && colour && font
}
