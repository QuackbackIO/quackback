import { describe, expect, it } from 'vitest'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { parseOklch } from '@/lib/shared/theme/expand'
import { blendHue, liftToward, mixColor, normaliseColor } from '../color'

const lch = (hex: string) => parseOklch(hexToOklch(hex))!
/** How far apart two hues are around the wheel, in degrees. */
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

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

describe('blendHue', () => {
  // A vivid blue and a vivid orange, near opposite on the wheel.
  const blue = '#533afb'
  const orange = '#fd9330'

  it('keeps the colour between two hues vivid, where a straight mix goes grey', () => {
    const grey = lch(mixColor(blue, orange, 0.5))
    const between = lch(blendHue(blue, orange, 0.5))
    expect(grey.c).toBeLessThan(0.1)
    expect(between.c).toBeGreaterThan(0.15)
  })

  it('takes a hue between the two, never one neither leans to', () => {
    const [a, b, mid] = [blue, orange, blendHue(blue, orange, 0.5)].map((x) => lch(x).h)
    // Blue into orange passes through magenta.
    expect(hueGap(mid!, a!) + hueGap(mid!, b!)).toBeLessThan(hueGap(a!, b!) + 2)
    // A pale lime into a violet, opposite on the wheel, takes the more vivid violet's hue, not a sky blue between.
    const violet = '#6f4ac1'
    const between = lch(blendHue('#c3f07a', violet, 0.5))
    expect(hueGap(between.h, lch(violet).h)).toBeLessThan(5)
  })

  it('gives either colour back at its end', () => {
    expect(blendHue(blue, orange, 1)).toBe(blue)
    expect(blendHue(blue, orange, 0)).toBe(orange)
  })

  it('stays the same colour as a mix where neither has a hue', () => {
    expect(blendHue('#262626', '#ffffff', 0.5)).toBe(mixColor('#262626', '#ffffff', 0.5))
  })
})

describe('liftToward', () => {
  it('moves a colour toward a neutral page in lightness, keeping its hue and its colour', () => {
    const navy = '#251a52'
    const lifted = lch(liftToward(navy, '#ffffff', 0.5))
    const mixed = lch(mixColor(navy, '#ffffff', 0.5))
    expect(lifted.l).toBeCloseTo(mixed.l, 2)
    expect(lifted.c).toBeGreaterThan(mixed.c * 1.3)
    expect(hueGap(lifted.h, lch(navy).h)).toBeLessThan(8)
  })

  it('stays inside the screen colours, giving up colour rather than turning another hue', () => {
    const blue = '#533afb'
    for (const share of [0.9, 0.6, 0.3, 0.1]) {
      const lifted = lch(liftToward(blue, '#ffffff', share))
      expect(hueGap(lifted.h, lch(blue).h)).toBeLessThan(8)
    }
  })

  it('gives the colour back at a full share, and the page at none', () => {
    expect(liftToward('#251a52', '#ffffff', 1)).toBe('#251a52')
    expect(liftToward('#251a52', '#ffffff', 0)).toBe('#ffffff')
    expect(liftToward('#6a6db4', '#131573', 0)).toBe('#131573')
  })
})
