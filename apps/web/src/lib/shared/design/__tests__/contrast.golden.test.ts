/**
 * Golden contrast for today's theming: every preset and a sweep of accents
 * that once broke readability, in light and dark, measured on the colour
 * pairs the portal actually paints (contrast-golden.ts).
 *
 * Today's theming fails some pairs. They are recorded in
 * contrast.golden.known.json, and this test holds that list in both
 * directions: a new failure fails the test, and so does a fixed one until it
 * is removed from the list, so the list can only shrink. The design solver is
 * done when the list is empty.
 */
import { describe, expect, it } from 'vitest'
import { themePresets } from '@/lib/shared/theme/presets'
import { ACCENT_SWEEP, MODES, goldenFailures, goldenThemes } from './contrast-golden'
import known from './contrast.golden.known.json'

describe('golden contrast for presets and the accent sweep', () => {
  it('measures every preset and accent in both modes', () => {
    expect(goldenThemes()).toHaveLength(
      MODES.length * (Object.keys(themePresets).length + ACCENT_SWEEP.length)
    )
    expect(Object.keys(themePresets)).toHaveLength(16)
  })

  it('fails exactly the known pairs: no new failure, and no fixed one left on the list', () => {
    expect(goldenFailures()).toEqual(known)
  })
})
