import { describe, expect, it } from 'vitest'
import { expandTheme, generateChartColors } from '../expand'
import { hexToOklch, tryCssColorToHex } from '../colors'
import { contrastRatio, sameColour } from '../colour-setters'

const DARK_TEXT = 'oklch(0.145 0 0)'
const LIGHT_TEXT = 'oklch(0.985 0 0)'

describe('expandTheme with non-oklch brand colours', () => {
  it.each([
    ['#d1f470', DARK_TEXT],
    ['#ca8a04', DARK_TEXT],
    ['#533afd', LIGHT_TEXT],
    ['rgb(209, 244, 112)', DARK_TEXT],
    ['hsl(248, 98%, 61%)', LIGHT_TEXT],
  ])('%s gets readable button text', (primary, expected) => {
    expect(expandTheme({ primary }, { mode: 'light' }).primaryForeground).toBe(expected)
  })

  it('treats a hex primary like the oklch form of the same colour', () => {
    for (const hex of ['#d1f470', '#533afd', '#ca8a04']) {
      const fromHex = expandTheme({ primary: hex }, { mode: 'light' })
      const fromOklch = expandTheme({ primary: hexToOklch(hex) }, { mode: 'light' })
      // The main colour and what repeats it come back in the form given.
      const same = { primary: '', primaryInk: '', accentInk: '', chart1: '' }
      expect({ ...fromHex, ...same }).toEqual({ ...fromOklch, ...same })
      // hexToOklch rounds the hue to a degree, so the two may land a step apart.
      expect(sameColour(fromHex.primaryInk, tryCssColorToHex(fromOklch.primaryInk!)!)).toBe(true)
    }
  })

  it('darkens the main colour as text for a light hex primary on a light page only', () => {
    const light = expandTheme({ primary: '#d1f470' }, { mode: 'light' })
    expect(contrastRatio(light.primaryInk!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(expandTheme({ primary: '#d1f470' }, { mode: 'dark' }).primaryInk).toBe('#d1f470')
  })

  it('derives chart colours from a hex primary', () => {
    const charts = generateChartColors('#533afd')
    expect(charts[0]).toBe('#533afd')
    expect(charts[1]).toMatch(/^oklch\(/)
    expect(charts.slice(1)).not.toContain('oklch(0.696 0.149 163)')
  })
})
