import { describe, expect, it } from 'vitest'
import { normaliseColor } from '../color'

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
