/**
 * Whatever colours Import your brand or Ask sets for the main colour, the
 * page, its text and the header bar, in light or dark, every text the portal
 * draws reads at 4.5:1 (WCAG AA, normal-size text) on what it sits on.
 *
 * Sweeps a grid of colours (mid-tones near the luminance where neither black
 * nor white reads well, saturated yellows, indigo, teal, near-black,
 * near-white, and text about the colour of its page) through the real
 * expansion, as the editor's setters write them and as bare stored values.
 */
import { describe, expect, it } from 'vitest'
import { hexToOklch, oklchToHex, tryCssColorToHex } from '../colors'
import { applyColour, type ColourRole } from '../colour-setters'
import { expandTheme, parseOklch, unbrandedTheme, type MinimalThemeVariables } from '../expand'
import { generateWorkspaceThemeCSS } from '../generator'
import type { ThemeVariables } from '../types'

const COLOURS = [
  '#6366f1', // indigo
  '#0d9488', // teal
  '#14b8a6',
  '#059669',
  '#0284c7',
  '#facc15', // saturated yellows
  '#ffe600',
  '#d1f470',
  '#ca8a04',
  '#ff6600', // orange
  '#e11d48',
  '#9333ea',
  '#2563eb',
  '#757575', // luminance near 0.18, where neither black nor white reads well
  '#767676',
  '#787878',
  '#7b7b7b',
  '#808080',
  '#5f8f3a',
  '#b0584a',
  '#000000', // near-black and near-white
  '#0a0a0a',
  '#171717',
  '#0b1220',
  '#1e1f22', // dark grey pages, and dark brands that must be lightened on them
  '#2b2d42',
  '#313338',
  '#113b92',
  '#3b0764',
  '#f5f7fb',
  '#fafafa',
  '#ffffff',
]

/** The grid for two roles at once: one of each kind above, text about its page's colour included. */
const PAIR_COLOURS = [
  '#6366f1',
  '#0d9488',
  '#facc15',
  '#d1f470',
  '#ff6600',
  '#e11d48',
  '#757575',
  '#787878',
  '#7b7b7b',
  '#5f8f3a',
  '#000000',
  '#171717',
  '#313338',
  '#113b92',
  '#f5f7fb',
  '#ffffff',
]

const ROLES: ColourRole[] = ['primary', 'background', 'foreground', 'header']
const MODES = ['light', 'dark'] as const
type Palette = Partial<MinimalThemeVariables>

/** WCAG contrast of two colours, failing the test on one that cannot be read. */
function contrast(a: string | undefined, b: string | undefined): number {
  const x = a ? tryCssColorToHex(resolveMix(a)) : null
  const y = b ? tryCssColorToHex(resolveMix(b)) : null
  expect(x, `colour ${a} parses`).toBeTruthy()
  expect(y, `colour ${b} parses`).toBeTruthy()
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(x!), lum(y!)].sort((p, q) => q - p) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** `color-mix(in oklab, A p%, B)` as the browser works it out, as hex. */
function resolveMix(colour: string): string {
  const match = colour.match(/^color-mix\(in oklab, (#[\da-f]{6}) ([\d.]+)%, (#[\da-f]{6})\)$/i)
  if (!match) return colour
  const lab = (hex: string) => {
    const { l, c, h } = parseOklch(hexToOklch(hex))!
    return [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]
  }
  const p = parseFloat(match[2]!) / 100
  const [a, b] = [lab(match[1]!), lab(match[3]!)]
  const [l, x, y] = a.map((v, i) => v * p + b[i]! * (1 - p)) as [number, number, number]
  const c = Math.hypot(x, y)
  const h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  return oklchToHex(`oklch(${l} ${c} ${h})`)
}

/** Every text-on-surface pair the portal draws, by name. */
function pairs(vars: ThemeVariables, mode: 'light' | 'dark'): Array<[string, string?, string?]> {
  const list: Array<[string, string?, string?]> = [
    ['text on page', vars.foreground, vars.background],
    ['text on card', vars.foreground, vars.card],
    ['text on quiet fill', vars.foreground, vars.muted],
    ['quiet text on page', vars.mutedForeground, vars.background],
    ['quiet text on card', vars.mutedForeground, vars.card],
    ['button text on button', vars.primaryForeground, vars.primary],
    ['main-colour text on page', vars.primaryInk, vars.background],
    ['main-colour text on card', vars.primaryInk, vars.card],
    ['main-colour text on quiet fill', vars.primaryInk, vars.muted],
  ]
  // Light pages send any text-primary left in the stylesheet to --accent-ink.
  if (mode === 'light') list.push(['accent ink on page', vars.accentInk, vars.background])
  if (vars.header) {
    list.push(
      ['header text on header', vars.headerForeground, vars.header],
      ['inactive tab on header', vars.navInactiveColor, vars.header],
      ['active tab text on active tab', vars.navActiveForeground, vars.navActiveBackground],
      ['header button text on header button', vars.headerPrimaryForeground, vars.headerPrimary]
    )
  }
  return list
}

function failures(palette: Palette, mode: 'light' | 'dark'): string[] {
  const vars = expandTheme(palette, { mode })
  return pairs(vars, mode).flatMap(([name, text, surface]) => {
    const ratio = contrast(text, surface)
    return ratio >= 4.5
      ? []
      : [`${mode} ${JSON.stringify(palette)}: ${name} ${text} on ${surface} = ${ratio.toFixed(2)}`]
  })
}

/** Both palettes as the editor's setters write them: unbranded, then each colour set in turn. */
function bothViaSetters(
  mode: 'light' | 'dark',
  set: Partial<Record<ColourRole, string>>
): { light: Palette; dark: Palette } {
  let palettes = {
    light: unbrandedTheme('light') as Palette,
    dark: unbrandedTheme('dark') as Palette,
  }
  // Background first: it brings along the card, the quiet fill and the text.
  for (const role of ['background', 'foreground', 'primary', 'header'] as const) {
    const hex = set[role]
    if (hex) palettes = applyColour(palettes.light, palettes.dark, role, mode, hex)
  }
  return palettes
}

const viaSetters = (mode: 'light' | 'dark', set: Partial<Record<ColourRole, string>>) =>
  bothViaSetters(mode, set)[mode]

/** One role over the whole grid, and every pair of roles over it. */
function grids(): Array<Partial<Record<ColourRole, string>>> {
  const out: Array<Partial<Record<ColourRole, string>>> = []
  for (const role of ROLES) for (const hex of COLOURS) out.push({ [role]: hex })
  const pairsOfRoles: Array<[ColourRole, ColourRole]> = [
    ['background', 'foreground'],
    ['background', 'primary'],
    ['background', 'header'],
    ['header', 'primary'],
    ['header', 'foreground'],
  ]
  for (const [a, b] of pairsOfRoles)
    for (const x of PAIR_COLOURS) for (const y of PAIR_COLOURS) out.push({ [a]: x, [b]: y })
  return out
}

describe('every portal text reads at 4.5:1, whatever the colours', () => {
  const sets = grids()
  for (const mode of MODES) {
    it(`as the editor writes them, ${mode}`, () => {
      const failed = sets.flatMap((set) => failures(viaSetters(mode, set), mode))
      expect(failed.slice(0, 10)).toEqual([])
    })

    it(`as stored values, ${mode}`, () => {
      const failed = sets.flatMap((set) => failures(set as Palette, mode))
      expect(failed.slice(0, 10)).toEqual([])
    })
  }
})

describe('the readable shade reaches every page the theme is written to', () => {
  it('declares --primary-ink on the document in light and dark (portal, widget and their overlays)', () => {
    const css = generateWorkspaceThemeCSS({
      light: { primary: '#facc15' },
      dark: { primary: '#1e3a8a' },
    })
    const block = (selector: string) => css.match(new RegExp(`${selector} \\{([^}]*)\\}`))?.[1]
    expect(block(':root')).toMatch(/--primary-ink: [^;]+;/)
    expect(block('\\.dark')).toMatch(/--primary-ink: [^;]+;/)
  })
})
