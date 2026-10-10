import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The success and warning tokens colour text (badges, inline status lines), so
 * in the light theme they must read at WCAG AA (4.5:1) on the page and on the
 * 15% tint the Badge variants put behind them.
 */
const css = readFileSync(join(__dirname, '../../../globals.css'), 'utf-8')

function lightToken(name: string): [number, number, number] {
  const root = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'))
  const match = root.match(new RegExp(`--${name}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`))
  if (!match) throw new Error(`--${name} not found in the light theme`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function linearSrgb([L, C, h]: [number, number, number]): number[] {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)))
}

const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The colour of `fg` at `alpha` over white, blended the way browsers do (in sRGB). */
function tint(fg: number[], alpha: number): number[] {
  return fg.map((v) => decode(encode(v) * alpha + (1 - alpha)))
}

describe('status token contrast', () => {
  const white = [1, 1, 1]

  it.each(['success', 'warning'])('%s text reads at AA on white and on its badge tint', (name) => {
    const fg = linearSrgb(lightToken(name))
    expect(contrast(fg, white)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(fg, tint(fg, 0.15))).toBeGreaterThanOrEqual(4.5)
  })
})
