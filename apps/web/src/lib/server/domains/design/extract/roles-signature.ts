/**
 * A black and white site's signature accent: the one vivid colour it uses
 * sparingly (a mark in the hero, a small button, a selected tile, a
 * highlight), too small for the identity rules to count, yet what makes the
 * site its own rather than a plain template. Measured on the site's own
 * interface only (photos, gradients and product pictures left out), never
 * a tint or a speck.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { chromaOf, type Swatch } from './colours'
import type { ShotEvidence } from './roles-evidence'

/** OKLab chroma a signature accent reaches: a vivid colour, not a pastel or a tinted grey. */
export const SIGNATURE_CHROMA = 0.13
/** The least of the interface it covers: a mark or a button, not an icon's speck. */
export const SIGNATURE_SHARE = 0.003

export interface Signature {
  hex: string
  share: number
  why: string
}

/** The site's signature accent, or null: the most present vivid spot across the screenshots. */
export function signatureAccent(shots: readonly Pick<ShotEvidence, 'spots'>[]): Signature | null {
  let best: { s: Swatch; weight: number } | null = null
  for (const shot of shots)
    for (const s of shot.spots ?? []) {
      const chroma = chromaOf(s.lab)
      if (chroma < SIGNATURE_CHROMA || s.share < SIGNATURE_SHARE) continue
      const weight = s.share * chroma
      if (!best || weight > best.weight) best = { s, weight }
    }
  if (!best) return null
  const { hex, share } = best.s
  const pct = Math.max(0.1, Math.round(share * 1000) / 10)
  return {
    hex,
    share,
    why: `a black and white site whose one vivid colour, ${hex}, marks ${pct}% of the page: its signature accent`,
  }
}
