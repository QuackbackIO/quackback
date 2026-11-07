import type { ThemeVariables } from '@/lib/shared/theme/types'
import { overlay, solveContrast } from './contrast'

/** How strongly the voted vote box is tinted with its own colour (`bg-post-card-voted/15`). */
export const VOTED_TINT = 0.15

/**
 * The voted vote box's colour: accent text, moved until its count reads at
 * 4.5:1 on its own tint over cards and the page. The tint follows the colour,
 * so it is measured again after each move; else the text colour.
 */
export function votedInk(t: Required<ThemeVariables>): string {
  let ink = t.accentInk
  for (let round = 0; round < 8; round++) {
    const tints = [t.card, t.background].map((under) => overlay(ink, under, VOTED_TINT))
    const next = solveContrast(ink, tints, 4.5)
    if (!next) break
    if (next === ink) return ink
    ink = next
  }
  return t.foreground
}
