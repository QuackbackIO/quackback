import { describe, it, expect } from 'vitest'
import { cssColorToHex, tryCssColorToHex } from '../colors'

describe('cssColorToHex', () => {
  it.each([
    ['#0e7c66', '#0e7c66'],
    ['#0E7C66', '#0e7c66'],
    ['#fff', '#ffffff'],
    ['#ABC', '#aabbcc'],
    ['0e7c66', '#0e7c66'],
    ['rgb(14, 124, 102)', '#0e7c66'],
    ['rgb(14 124 102)', '#0e7c66'],
    ['rgba(255, 0, 0, 0.5)', '#ff0000'],
    ['hsl(0, 100%, 50%)', '#ff0000'],
    ['hsl(120 100% 25%)', '#008000'],
    ['hsl(240deg 100% 50%)', '#0000ff'],
    ['oklch(1 0 0)', '#ffffff'],
    ['oklch(0 0 0)', '#000000'],
    ['oklab(1 0 0)', '#ffffff'],
    ['#0e7c66ff', '#0e7c66'],
    ['#0E7C6680', '#0e7c66'],
    ['#fffa', '#ffffff'],
    ['oklch(100% 0 0)', '#ffffff'],
    ['oklch(0% 0 0)', '#000000'],
    ['oklab(100% 0 0)', '#ffffff'],
    ['rgb(100%, 0%, 0%)', '#ff0000'],
    ['rgb(255 0 0 / 50%)', '#ff0000'],
  ])('%s -> %s', (input, expected) => {
    expect(cssColorToHex(input)).toBe(expected)
  })

  it('falls back to black for values it cannot parse', () => {
    expect(cssColorToHex('garbage')).toBe('#000000')
    expect(cssColorToHex('')).toBe('#000000')
    expect(cssColorToHex('#12')).toBe('#000000')
  })
})

describe('tryCssColorToHex', () => {
  it('returns null for unparseable and malformed values', () => {
    for (const bad of [
      'garbage',
      '',
      '#12',
      'rgb(. 1 2)',
      'rgb(1 2)',
      'hsl(a 1% 2%)',
      'oklch(x 0 0)',
    ])
      expect(tryCssColorToHex(bad)).toBeNull()
  })
  it('keeps the black fallback in cssColorToHex for malformed values', () => {
    expect(cssColorToHex('rgb(. 1 2)')).toBe('#000000')
  })
})
