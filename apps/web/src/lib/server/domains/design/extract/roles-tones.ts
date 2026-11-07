/**
 * The tones colour evidence is read by: a grey's chroma, a dark page's
 * lightness, a pale neutral fill, a colour as hex, and how many pixels make a
 * CSS px. Shared by the evidence (roles-evidence.ts), the buttons' evidence
 * (roles-buttons.ts) and the decisions built on them.
 *
 * Pure: no app imports.
 */
import type { RGB } from './color'
import { chromaOf } from './colours'

export const NEUTRAL = 0.045
/** OKLab lightness under which a page is dark (near black, charcoal, deep navy). */
export const DARK_PAGE = 0.4
/** OKLab lightness over which a text colour is a dark site's light type. */
export const LIGHT_TEXT = 0.7
export const isLightNeutral = (s: { lab: readonly number[] }) =>
  s.lab[0]! > 0.88 && chromaOf(s.lab) < 0.03

/** Pixels per CSS px, from the width (a screenshot of a desktop page is about 1440 CSS px wide). */
export function unitOf(img: { width: number }): number {
  return Math.min(2, Math.max(0.5, img.width / 1440))
}

export const swatchHex = (rgb: RGB) =>
  `#${rgb
    .map((v) =>
      Math.min(255, Math.max(0, Math.round(v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
