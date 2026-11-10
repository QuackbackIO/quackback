import { BUNDLED_FONT_IDS } from '@/lib/shared/design/options'
import { loadBrandingFont } from '@/lib/shared/theme/font-loader'

const asked = new Set<string>()

/**
 * Loads each bundled family's stylesheet once, when a font list first opens,
 * so every name shows in its own face. A stylesheet only declares its faces:
 * the browser fetches just the file each name is drawn with.
 */
export function loadFontPreviews(): void {
  for (const id of BUNDLED_FONT_IDS) {
    if (asked.has(id)) continue
    asked.add(id)
    loadBrandingFont(id).catch(() => asked.delete(id))
  }
}
