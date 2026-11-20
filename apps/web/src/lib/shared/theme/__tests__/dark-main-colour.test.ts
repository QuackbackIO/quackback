/**
 * A dark main colour on a dark page: filled buttons must stand off the page
 * as a control does (3:1, WCAG 1.4.11). In dark mode a main colour that does
 * not is lightened (OKLCH lightness, same hue) just until it does, and the
 * words on the button still read (4.5:1).
 */
import { describe, expect, it } from 'vitest'
import { tryCssColorToHex } from '../colors'
import { applyColour, contrastRatio } from '../colour-setters'
import { expandTheme, parseOklch } from '../expand'

const hue = (colour: string) => parseOklch(colour)!.h
/** The expanded dark theme's main colour and the words on it. */
const darkOf = (primary: string, background: string) => {
  const theme = expandTheme({ primary, background }, { mode: 'dark' })
  return { primary: theme.primary!, primaryForeground: theme.primaryForeground! }
}
const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

describe('the words on a filled button', () => {
  it('are set in the ink that reads on the main colour, where the usual one would not', () => {
    // Mid blues, a green and an indigo: white falls just short of 4.5:1 on each.
    for (const primary of ['#0073e6', '#08872b', '#007bc8', '#6366f1']) {
      for (const mode of ['light', 'dark'] as const) {
        const theme = expandTheme({ primary }, { mode })
        expect(contrastRatio(theme.primaryForeground!, theme.primary!)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('stay as they were wherever the usual ink already reads', () => {
    expect(expandTheme({ primary: '#533afd' }, { mode: 'light' }).primaryForeground).toBe(
      'oklch(0.985 0 0)'
    )
    expect(expandTheme({}, { mode: 'light' }).primaryForeground).toBe('oklch(0.145 0 0)')
    expect(expandTheme({ primary: '#111111' }, { mode: 'light' }).primaryForeground).toBe(
      'oklch(0.985 0 0)'
    )
  })
})

describe('a dark main colour in dark mode', () => {
  const navy = '#113b92'

  it('is lightened until a filled button stands off the page by 3:1, keeping its hue', () => {
    const dark = darkOf(navy, '#0a0a0a')
    expect(contrastRatio(navy, '#0a0a0a')).toBeLessThan(3)
    expect(contrastRatio(dark.primary, '#0a0a0a')).toBeGreaterThanOrEqual(3)
    // No further than it takes: still a deep blue, not a pastel.
    expect(contrastRatio(dark.primary, '#0a0a0a')).toBeLessThan(3.6)
    expect(apart(hue(dark.primary), hue(navy))).toBeLessThan(8)
    expect(parseOklch(dark.primary)!.l).toBeGreaterThan(parseOklch(navy)!.l)
  })

  it('keeps the words on the button readable', () => {
    for (const background of ['#0a0a0a', '#1e1f22', '#2b2d42', '#313338']) {
      for (const primary of [navy, '#1a1a2e', '#4a0d0d', '#0b3d2e', '#3b0764', '#5c4400']) {
        const dark = darkOf(primary, background)
        expect(contrastRatio(dark.primary, background)).toBeGreaterThanOrEqual(3)
        expect(contrastRatio(dark.primaryForeground, dark.primary)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('leaves a main colour that already shows as it is', () => {
    for (const primary of ['#635bff', '#fafafa', 'oklch(0.886 0.176 86)']) {
      expect(expandTheme({ primary, background: '#0a0a0a' }, { mode: 'dark' }).primary).toBe(
        primary
      )
    }
  })

  it('never touches light mode', () => {
    expect(
      expandTheme({ primary: '#f4f4f5', background: '#ffffff' }, { mode: 'light' }).primary
    ).toBe('#f4f4f5')
  })

  it('is stable: the lightened colour expands to itself', () => {
    const once = darkOf(navy, '#0a0a0a').primary
    expect(darkOf(once, '#0a0a0a').primary).toBe(once)
  })

  it('a dark primary that was lightened still follows the light one when it changes', () => {
    // As the editor holds it after a round trip through the stylesheet.
    const shown = tryCssColorToHex(darkOf(navy, '#0a0a0a').primary)!
    const next = applyColour(
      { primary: navy },
      { primary: shown, background: '#0a0a0a' },
      'primary',
      'light',
      '#e11d48'
    )
    expect(next.dark.primary).toBe('#e11d48')
  })
})
