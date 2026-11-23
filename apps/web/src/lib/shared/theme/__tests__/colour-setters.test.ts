/**
 * The colours a page colour brings along: its card, its quiet fill, its
 * border and its quiet text, which has to read wherever it is drawn.
 */
import { describe, expect, it } from 'vitest'
import { applyColour, contrastRatio, isDarkBackground } from '../colour-setters'

describe('the quiet text a page colour brings', () => {
  // Quiet text sits on the page, on cards and on the quiet fill (an avatar's
  // initials, a chip): it has to read on all three, whatever the page colour.
  it.each(['#1a2081', '#212529', '#0090e3', '#2d6a4f', '#7a1f1f', '#9aa0a6', '#ffffff', '#0a0a0a'])(
    'reads on a %s page, its cards and its quiet fill',
    (page) => {
      const mode = isDarkBackground(page) ? 'dark' : 'light'
      const palette = applyColour({}, {}, 'background', mode, page)[mode]
      for (const surface of [palette.background!, palette.card!, palette.muted!])
        expect(contrastRatio(palette.mutedForeground!, surface)).toBeGreaterThanOrEqual(4.5)
    }
  )

  it('stays the usual grey on the usual pages', () => {
    expect(applyColour({}, {}, 'background', 'light', '#ffffff').light.mutedForeground).toBe(
      '#525252'
    )
    expect(applyColour({}, {}, 'background', 'dark', '#0a0a0a').dark.mutedForeground).toBe(
      '#a1a1a1'
    )
  })
})
