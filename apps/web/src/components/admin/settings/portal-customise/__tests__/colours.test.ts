/**
 * Colours on the Customise page: warnings only when something fails, a Fix
 * that keeps the hue, and a hex box that takes the formats people paste.
 */
import { describe, expect, it } from 'vitest'
import { tryCssColorToHex } from '@/lib/shared/theme'
import { contrastRatio, fixLinkContrast } from '@/lib/shared/theme/colour-setters'
import { colourWarnings, parseColourInput, roleSuggestions } from '../colours'

const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return Math.round(((h * 60 + 360) % 360) / 5) * 5
}

describe('colourWarnings', () => {
  it('says nothing when everything reads', () => {
    expect(
      colourWarnings({ primary: '#533afd', background: '#ffffff', foreground: '#0a0a0a' })
    ).toEqual([])
  })

  it('warns when links are hard to read on the background', () => {
    expect(
      colourWarnings({ primary: '#ffd43b', background: '#ffffff', foreground: '#0a0a0a' })
    ).toEqual(['links'])
  })

  it('warns when text is hard to read on the background', () => {
    expect(
      colourWarnings({ primary: '#111111', background: '#ffffff', foreground: '#bbbbbb' })
    ).toEqual(['text'])
  })
})

describe('fixLinkContrast', () => {
  it('darkens a light-page main colour until links reach 3:1, keeping its hue', () => {
    const fixed = fixLinkContrast('#ffd43b', '#ffffff')
    expect(contrastRatio(fixed, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(hue(fixed)).toBe(hue('#ffd43b'))
  })

  it('lightens a dark-page main colour until links reach 3:1', () => {
    const fixed = fixLinkContrast('#1a1a6e', '#0a0a0a')
    expect(contrastRatio(fixed, '#0a0a0a')).toBeGreaterThanOrEqual(3)
  })

  it('leaves a colour that already reads alone', () => {
    expect(fixLinkContrast('#533afd', '#ffffff')).toBe('#533afd')
  })
})

describe('parseColourInput', () => {
  it.each([
    ['533AFD', '#533afd'],
    ['#533afd', '#533afd'],
    ['#53f', '#5533ff'],
    ['rgb(83, 58, 253)', '#533afd'],
    ['  #533AFD ', '#533afd'],
  ])('reads %s', (input, hex) => {
    expect(parseColourInput(input)).toBe(hex)
  })

  it.each(['', 'blue-ish', '#12', 'rgb(1,2)'])('refuses %j', (input) => {
    expect(parseColourInput(input)).toBeNull()
  })
})

describe('roleSuggestions', () => {
  it('offers site colours first, then the role suggestions, ten at most', () => {
    const swatches = roleSuggestions('primary', 'light', { primary: '#533afd' }, ['#010203'])
    expect(swatches[0]!.hex).toBe('#010203')
    expect(swatches.length).toBeLessThanOrEqual(10)
    expect(swatches.map((s) => s.hex)).toContain('#2563eb')
  })

  it('tints the background suggestions with the main colour', () => {
    const swatches = roleSuggestions('background', 'light', { primary: '#533afd' })
    const tinted = swatches.find((s) => s.name === 'Tinted')
    expect(tinted && tryCssColorToHex(tinted.hex)).toBeTruthy()
    expect(tinted?.hex).not.toBe('#ffffff')
  })
})
