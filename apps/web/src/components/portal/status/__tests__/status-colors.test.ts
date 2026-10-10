/**
 * Every text color the status page pairs with a status surface must reach
 * WCAG AA for small text (4.5:1), in light and dark mode. White on the
 * emerald/amber/orange 600 banners and the translucent white labels on them
 * fell short, as did the 600 text shades on their soft chips.
 *
 * Ratios are computed from Tailwind's own palette (oklch, converted to sRGB
 * the way CSS Color 4 does), against the portal's page surfaces.
 */
import { describe, expect, it } from 'vitest'
import palette from 'tailwindcss/colors'
import {
  COMPONENT_STATUS_STYLE,
  IMPACT_STYLE,
  LIFECYCLE_STYLE,
  type StatusColorStyle,
} from '../status-colors'

type Rgb = [number, number, number]

const LIGHT_SURFACE: Rgb = [1, 1, 1] // --background / --card
const DARK_SURFACE: Rgb = [15 / 255, 15 / 255, 15 / 255] // dark --card (#0f0f0f), the lighter of the two

function oklchToSrgb(css: string): Rgb {
  const match = /oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/.exec(css)
  if (!match) throw new Error(`not an oklch color: ${css}`)
  const [l, c, h] = [Number(match[1]) / 100, Number(match[2]), (Number(match[3]) * Math.PI) / 180]
  const [a, b] = [c * Math.cos(h), c * Math.sin(h)]
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ]
  const linear = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ]
  return linear.map((v) => {
    const clipped = Math.min(1, Math.max(0, v))
    return clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055
  }) as Rgb
}

/** `emerald-700` / `white` → sRGB. */
function color(name: string): Rgb {
  if (name === 'white') return [1, 1, 1]
  const [family, shade] = name.split('-') as [keyof typeof palette, string]
  return oklchToSrgb((palette[family] as Record<string, string>)[shade])
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** A translucent fill composited over a surface, as the browser paints it. */
function over(fill: Rgb, alpha: number, surface: Rgb): Rgb {
  return fill.map((v, i) => v * alpha + surface[i] * (1 - alpha)) as Rgb
}

function classColor(classes: string, prefix: 'bg' | 'text', dark = false): string | null {
  const pattern = new RegExp(
    `(?:^|\\s)${dark ? 'dark:' : ''}${prefix}-((?:[a-z]+-\\d+)|white)(?:/(\\d+))?(?=\\s|$)`
  )
  return pattern.exec(classes)?.[1] ?? null
}

const styles: Array<[string, StatusColorStyle]> = [
  ...Object.entries(COMPONENT_STATUS_STYLE).map(([k, v]): [string, StatusColorStyle] => [
    `component ${k}`,
    v,
  ]),
  ...Object.entries(IMPACT_STYLE).map(([k, v]): [string, StatusColorStyle] => [`impact ${k}`, v]),
  ...Object.entries(LIFECYCLE_STYLE).map(([k, v]): [string, StatusColorStyle] => [
    `lifecycle ${k}`,
    v,
  ]),
]

const AA = 4.5

describe('status colors reach WCAG AA for small text', () => {
  it.each(styles)('%s: text on its solid banner', (_, style) => {
    const bg = classColor(style.solid, 'bg')
    const fg = classColor(style.solid, 'text')
    expect(bg, 'solid names its fill').not.toBeNull()
    expect(fg, 'solid names the text color that goes on it').not.toBeNull()
    expect(contrast(color(fg!), color(bg!))).toBeGreaterThanOrEqual(AA)
  })

  // The gray (no impact) style uses theme tokens for its text, not the palette.
  const paletteText = styles.filter(([, style]) => classColor(style.text, 'text') !== null)

  it.each(paletteText)('%s: text on the page and on its soft chip, light mode', (_, style) => {
    const text = color(classColor(style.text, 'text')!)
    const chip = /bg-([a-z]+-\d+)\/(\d+)/.exec(style.soft)!
    const chipOnLight = over(color(chip[1]), Number(chip[2]) / 100, LIGHT_SURFACE)
    expect(contrast(text, LIGHT_SURFACE)).toBeGreaterThanOrEqual(AA)
    expect(contrast(text, chipOnLight)).toBeGreaterThanOrEqual(AA)
  })

  it.each(paletteText)('%s: text on the page and on its soft chip, dark mode', (_, style) => {
    const text = color(classColor(style.text, 'text', true)!)
    const chip = /bg-([a-z]+-\d+)\/(\d+)/.exec(style.soft)!
    const chipOnDark = over(color(chip[1]), Number(chip[2]) / 100, DARK_SURFACE)
    expect(contrast(text, DARK_SURFACE)).toBeGreaterThanOrEqual(AA)
    expect(contrast(text, chipOnDark)).toBeGreaterThanOrEqual(AA)
  })
})
