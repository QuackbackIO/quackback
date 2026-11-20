import { describe, expect, it } from 'vitest'
import { computeAccentInk, expandTheme, generateChartColors } from '../expand'
import { hexToOklch } from '../colors'

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
      expect({ ...fromHex, primary: '', accentInk: '', chart1: '' }).toEqual({
        ...fromOklch,
        primary: '',
        accentInk: '',
        chart1: '',
      })
    }
  })

  it('lowers accent ink for a light hex primary in light mode only', () => {
    expect(computeAccentInk('#d1f470', 'light')).toMatch(/^oklch\(0\.720 /)
    expect(computeAccentInk('#d1f470', 'dark')).toBe('#d1f470')
  })

  it('derives chart colours from a hex primary', () => {
    const charts = generateChartColors('#533afd')
    expect(charts[0]).toBe('#533afd')
    expect(charts[1]).toMatch(/^oklch\(/)
    expect(charts.slice(1)).not.toContain('oklch(0.696 0.149 163)')
  })
})
