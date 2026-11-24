/** A palette's colours as their hex boxes show them, plain so the server can use them too. */
import { tryCssColorToHex } from '@/lib/shared/theme'
import { pickedColour } from '@/lib/shared/theme/base'
import type { ColourRole } from '@/lib/shared/theme/colour-setters'
import type { Palette } from '@/lib/shared/theme/theme-css'

export const hexOrNull = (colour: string | undefined) => (colour ? tryCssColorToHex(colour) : null)

/** The colour picked for a role, as hex: what its hex box shows and the picker starts from. */
export function pickedHex(palette: Palette, role: ColourRole): string | null {
  return hexOrNull(
    role === 'primary' || role === 'foreground' ? pickedColour(palette, role) : palette[role]
  )
}
