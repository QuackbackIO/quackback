import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hexContrastRatio } from '@/lib/shared/website-brand-color'

const dir = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(dir, '../admin-theme.css'), 'utf8')
const adminRoute = readFileSync(join(dir, '../../routes/admin.tsx'), 'utf8')
const rootRoute = readFileSync(join(dir, '../../routes/__root.tsx'), 'utf8')
const globals = readFileSync(join(dir, '../../globals.css'), 'utf8')

const LIGHT = ':root:has([data-admin-shell]) {'
const DARK = ':root.dark:has([data-admin-shell]),\n:root.dark [data-admin-canvas] {'

/** The declarations of the block that opens with `head`, as a name → value map. */
function tokens(head: string): Map<string, string> {
  const start = css.indexOf(head)
  expect(start, `block not found: ${head}`).toBeGreaterThanOrEqual(0)
  const body = css.slice(start + head.length, css.indexOf('}', start))
  const map = new Map<string, string>()
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) map.set(m[1], m[2].trim())
  return map
}

const light = tokens(LIGHT)
const dark = tokens(DARK)

/** WCAG contrast between two hex colours, from the app's shared helper. */
const contrast = hexContrastRatio

/** Strip comments and @font-face / @import, leaving the style rules' selectors. */
function selectors(): string[] {
  const rules = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]+;/g, '')
    .replace(/@font-face\s*{[^}]*}/g, '')
  return [...rules.matchAll(/([^{}]+){[^{}]*}/g)].map((m) => m[1].trim())
}

describe('admin theme stylesheet', () => {
  it('is linked from the admin route only, never from the root document', () => {
    expect(adminRoute).toContain("import adminThemeCss from '@/styles/admin-theme.css?url'")
    expect(adminRoute).toContain("{ rel: 'stylesheet', href: adminThemeCss }")
    expect(rootRoute).not.toContain('admin-theme.css')
    expect(globals).not.toContain('admin-theme.css')
  })

  it('scopes every rule to a document with the admin shell', () => {
    const list = selectors()
    expect(list.length).toBeGreaterThan(3)
    for (const selector of list) {
      for (const part of selector.split(/,(?![^(]*\))/)) {
        expect(part, selector).toMatch(/\[data-admin-(shell|canvas)\]/)
      }
    }
  })

  it.each([
    ['--background', '#ffffff', '#1b1b1b'],
    ['--foreground', '#111111', '#f2f2f2'],
    ['--card', '#ffffff', '#1b1b1b'],
    ['--popover', '#ffffff', '#1b1b1b'],
    ['--primary', '#111111', '#f2f2f2'],
    ['--muted-foreground', '#5f5d56', '#a3a3a3'],
    ['--destructive', '#b3261e', '#ff7b6b'],
    ['--warning', '#8a5300', '#ee9d3a'],
    ['--border', '#e8e5dc', '#2a2a2a'],
    ['--input', '#8a887f', '#767676'],
    ['--chart-1', '#b27923', '#c68206'],
    ['--chart-2', '#4687d8', '#5294e6'],
    ['--chart-3', '#89365b', '#b8527e'],
    ['--chart-4', '#1d9999', '#34a89e'],
    ['--metric-posts', '#111111', '#f2f2f2'],
    ['--muted', '#f7f6f2', '#222222'],
    ['--chrome-background', '#f7f6f2', '#121212'],
    ['--chrome-active-icon', '#111111', '#f7cc29'],
  ])('%s is %s in light and %s in dark', (name, l, d) => {
    expect(light.get(name)).toBe(l)
    expect(dark.get(name)).toBe(d)
  })

  it('keeps text and control edges legible in both themes', () => {
    for (const t of [light, dark]) {
      const canvas = t.get('--background')!
      const surface = t.get('--card')!
      expect(contrast(t.get('--foreground')!, canvas)).toBeGreaterThanOrEqual(15)
      expect(contrast(t.get('--foreground')!, surface)).toBeGreaterThanOrEqual(15)
      expect(contrast(t.get('--muted-foreground')!, canvas)).toBeGreaterThanOrEqual(6.3)
      expect(contrast(t.get('--muted-foreground')!, surface)).toBeGreaterThanOrEqual(6.3)
      expect(contrast(t.get('--input')!, canvas)).toBeGreaterThanOrEqual(3)
      expect(contrast(t.get('--destructive')!, canvas)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.get('--warning')!, canvas)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.get('--primary-foreground')!, t.get('--primary')!)).toBeGreaterThanOrEqual(
        16
      )
    }
    // Dark danger is a light coral: the destructive button's dark text must clear AA.
    expect(
      contrast(dark.get('--destructive-foreground')!, dark.get('--destructive')!)
    ).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#ffffff', light.get('--destructive')!)).toBeGreaterThanOrEqual(4.5)
  })

  it('raises the work sheet above the rail in both themes', () => {
    for (const t of [light, dark]) {
      // Brighter means further from black.
      const sheet = contrast(t.get('--background')!, '#000000')
      const rail = contrast(t.get('--chrome-background')!, '#000000')
      // Raised means lighter: the sheet is brighter than the rail in light and dark.
      expect(sheet).toBeGreaterThan(rail)
    }
  })

  it('never uses duck for a single data series, where it would be too faint on beige', () => {
    for (const [name, value] of light) {
      if (name.startsWith('--metric-')) expect(value, name).not.toBe('#f7cc29')
    }
  })
})
