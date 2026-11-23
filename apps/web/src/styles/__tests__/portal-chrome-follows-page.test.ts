import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(dir, '../../globals.css'), 'utf8')
const adminCss = readFileSync(join(dir, '../admin-theme.css'), 'utf8')

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector}`)
  expect(start, `selector not found: ${selector}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  const body = css.slice(open + 1, css.indexOf('\n  }', open))
  const map = new Map<string, string>()
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) map.set(m[1], m[2].trim())
  return map
}

const light = block('  :root {')
const dark = block('  .dark {')

// Minimal oklab mixer, enough to resolve color-mix(in oklab, A p%, B).
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gam = (c: number) =>
  Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255)
function toLab(hex: string): number[] {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
function toHex([a, b, c]: number[]): string {
  const l = (a + 0.3963377774 * b + 0.2158037573 * c) ** 3
  const m = (a - 0.1055613458 * b - 0.0638541728 * c) ** 3
  const s = (a - 0.0894841775 * b - 1.291485548 * c) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return '#' + rgb.map((x) => gam(x).toString(16).padStart(2, '0')).join('')
}

/** Resolve a declaration to a hex colour through var() aliases and oklab color-mix. */
function resolve(vars: Map<string, string>, name: string): string {
  const value = vars.get(name)
  expect(value, name).toBeDefined()
  const alias = /^var\((--[\w-]+)\)$/.exec(value!)
  if (alias) return resolve(vars, alias[1])
  const mix = /^color-mix\(in oklab, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\)$/.exec(value!)
  if (mix) {
    const p = Number(mix[2]) / 100
    const a = toLab(resolve(vars, mix[1]))
    const b = toLab(resolve(vars, mix[3]))
    return toHex(a.map((x, i) => x * p + b[i] * (1 - p)))
  }
  expect(value).toMatch(/^#[\da-f]{6}$/)
  return value!
}

/** Every token the portal chrome reads, with the values it had before it followed the page. */
const TODAY = {
  light: {
    '--header-background': '#ffffff',
    '--header-foreground': '#0a0a0a',
    '--header-border': '#e5e5e5',
    '--post-card-border': '#e5e5e5',
    '--nav-active-background': '#f5f5f5',
    '--nav-active-foreground': '#0a0a0a',
    '--nav-inactive-color': '#525252',
  },
  dark: {
    '--header-background': '#0a0a0a',
    '--header-foreground': '#fafafa',
    '--header-border': '#262626',
    '--post-card-border': '#262626',
    '--nav-active-background': '#222222',
    '--nav-active-foreground': '#fafafa',
    '--nav-inactive-color': '#a1a1a1',
  },
}

describe('portal chrome follows the page', () => {
  it.each([
    ['light', light, TODAY.light],
    ['dark', dark, TODAY.dark],
  ] as const)('keeps the unbranded %s portal pixel-identical', (_mode, vars, expected) => {
    for (const [token, hex] of Object.entries(expected)) {
      expect(resolve(vars, token), token).toBe(hex)
    }
  })

  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('declares aliases, not fixed colours, in %s', (_mode, vars) => {
    const aliases: Record<string, RegExp> = {
      '--header-background': /^var\(--background\)$/,
      '--header-foreground': /^var\(--foreground\)$/,
      '--nav-active-background': /^var\(--muted\)$/,
      '--nav-active-foreground': /^var\(--foreground\)$/,
      '--nav-inactive-color': /^var\(--muted-foreground\)$/,
      '--header-border': /^(var\(--border\)|color-mix\(in oklab, var\(--border\) \d+%, .+\))$/,
      '--post-card-border': /^(var\(--border\)|color-mix\(in oklab, var\(--border\) \d+%, .+\))$/,
    }
    for (const [token, pattern] of Object.entries(aliases)) {
      expect(vars.get(token), token).toMatch(pattern)
    }
  })

  it('softens the light borders with a 60% oklab mix toward the page', () => {
    expect(light.get('--header-border')).toBe(
      'color-mix(in oklab, var(--border) 60%, var(--background))'
    )
    expect(light.get('--post-card-border')).toBe(light.get('--header-border'))
  })

  it('follows a branded page background', () => {
    const branded = new Map(light)
    branded.set('--background', '#fffefb')
    branded.set('--foreground', '#111111')
    expect(resolve(branded, '--header-background')).toBe('#fffefb')
    expect(resolve(branded, '--header-foreground')).toBe('#111111')
  })
})

describe('button radius token', () => {
  it('defaults to the item radius on the portal', () => {
    expect(light.get('--radius-button')).toBe('var(--radius-item)')
  })

  it('is mapped for tailwind and pinned in the admin shell to its own item radius', () => {
    expect(css).toMatch(/--radius-button:\s*var\(--radius-button\)/)
    expect(adminCss).toMatch(/--radius-button:\s*8px;/)
  })
})
