/**
 * A dark main colour on a dark page: filled buttons must stand off the page
 * as a control does (3:1, WCAG 1.4.11). In dark mode a main colour that does
 * not is lightened (OKLCH lightness, same hue) just until it does, and the
 * words on the button still read (white at 3:1 or more, else dark ink).
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
  const NEAR_WHITE = 'oklch(0.985 0 0)'
  const NEAR_BLACK = 'oklch(0.145 0 0)'
  const modes = ['light', 'dark'] as const
  const inkOn = (primary: string, mode: 'light' | 'dark') =>
    expandTheme({ primary }, { mode }).primaryForeground!

  it('stay white on mid-tone brands where white reaches 3:1, in pure white', () => {
    // Near-white falls short of 4.5:1 on each; pure white reaches 3:1 (3.75 to 4.47).
    for (const primary of ['#0d9488', '#059669', '#0284c7', '#6366f1']) {
      for (const mode of modes) {
        expect(inkOn(primary, mode)).toBe('#ffffff')
        expect(contrastRatio('#ffffff', primary)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('keep near-white where it already reads at 4.5:1', () => {
    for (const mode of modes) expect(inkOn('#2563eb', mode)).toBe(NEAR_WHITE)
    expect(inkOn('#113b92', 'light')).toBe(NEAR_WHITE)
    expect(inkOn('#533afd', 'light')).toBe(NEAR_WHITE)
    expect(inkOn('#111111', 'light')).toBe(NEAR_WHITE)
  })

  it('turn dark only where white falls below 3:1', () => {
    for (const primary of ['#f59e0b', '#4ade80', '#ca8a04']) {
      expect(contrastRatio('#ffffff', primary)).toBeLessThan(3)
      for (const mode of modes) expect(inkOn(primary, mode)).toBe(NEAR_BLACK)
    }
    expect(expandTheme({}, { mode: 'light' }).primaryForeground).toBe(NEAR_BLACK)
  })

  it('are the better of white and dark on every grey, and never under 3:1', () => {
    for (let v = 0; v <= 255; v += 5) {
      const grey = `#${v.toString(16).padStart(2, '0').repeat(3)}`
      const ink = inkOn(grey, 'light')
      const got = contrastRatio(ink, grey)
      expect(got).toBeGreaterThanOrEqual(3)
      if (contrastRatio('#ffffff', grey) < 3) {
        expect(got).toBeGreaterThanOrEqual(contrastRatio('#ffffff', grey))
      }
    }
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
        expect(contrastRatio(dark.primaryForeground, dark.primary)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('sets the words on a lightened colour by the same rule as any other fill', () => {
    for (const primary of [navy, '#1a1a2e', '#4a0d0d', '#0b3d2e', '#3b0764', '#5c4400']) {
      const dark = darkOf(primary, '#0a0a0a')
      // The colour the dark page shows, expanded on its own, gets the same ink.
      expect(dark.primaryForeground).toBe(
        expandTheme({ primary: dark.primary }, { mode: 'light' }).primaryForeground
      )
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
