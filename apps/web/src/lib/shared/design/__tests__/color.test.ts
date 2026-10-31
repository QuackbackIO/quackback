import { describe, expect, it } from 'vitest'
import { mixColor, normaliseColor } from '../color'

describe('normaliseColor', () => {
  it.each([
    ['six-digit hex, lowercased', '#0F766E', '#0f766e'],
    ['three-digit hex, expanded', '#FA0', '#ffaa00'],
    ['rgb() with commas', 'rgb(15, 118, 110)', '#0f766e'],
    ['rgb() with spaces', 'rgb(15 118 110)', '#0f766e'],
    ['hsl() with units', 'hsl(120deg 100% 25%)', '#008000'],
    ['hsl() with commas', 'hsl(0, 100%, 50%)', '#ff0000'],
    ['oklch(), reformatted', 'oklch(0.5 0.1 180)', 'oklch(0.500 0.100 180)'],
    ['oklch() with a percentage', 'oklch(50% 0.1 180)', 'oklch(0.500 0.100 180)'],
    ['surrounding space', '  #0f766e ', '#0f766e'],
  ])('accepts %s', (_label, input, expected) => {
    expect(normaliseColor(input)).toBe(expected)
  })

  it.each([
    ['a named colour', 'teal'],
    ['a CSS variable', 'var(--brand)'],
    ['a translucent colour', 'rgb(0 0 0 / 50%)'],
    ['an eight-digit hex', '#0f766e80'],
    ['a channel out of range', 'rgb(300, 0, 0)'],
    ['an unsafe value', 'red; } body {'],
    ['empty text', ''],
  ])('refuses %s', (_label, input) => {
    expect(normaliseColor(input)).toBeNull()
  })
})

describe('mixColor', () => {
  it('mixes in oklab and returns hex', () => {
    // Today's light hairline is 60% of the border over white.
    expect(mixColor('#d4d4d4', '#ffffff', 0.6)).toBe('#e5e5e5')
    expect(mixColor('#262626', '#0a0a0a', 1)).toBe('#262626')
    expect(mixColor('#262626', '#0a0a0a', 0)).toBe('#0a0a0a')
  })

  it('takes oklch as well as hex', () => {
    expect(mixColor('oklch(0.922 0 0)', '#ffffff', 1)).toBe('#e5e5e5')
  })
})
