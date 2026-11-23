import type { Hex } from '@/lib/shared/theme/brand-import'
import { luminance } from '@/lib/shared/theme/colour-setters'
import { colourHex, isNeutralColour } from './site-css'

/**
 * A page's theme-color as a main colour candidate, the same for every reader.
 * The value is whatever the site wrote, so only a colour literal counts
 * (`var()`, broken values and translucent colours read as none). It only tints
 * the browser's own bar, so white or near white never is a main colour, and a
 * grey one gives way when the site names other colours (`otherColours`). A
 * monochrome brand's near black stands.
 */
export function brandThemeColour(
  raw: string | null | undefined,
  { otherColours }: { otherColours: boolean }
): Hex | undefined {
  const theme = raw ? colourHex(raw) : null
  if (!theme || luminance(theme) > 0.85) return undefined
  if (isNeutralColour(theme) && otherColours) return undefined
  return theme as Hex
}
