/**
 * Portal text stays readable on every theme (WCAG AA, 4.5:1 for body-size
 * text), the default ones included. A brand or tag colour drawn as text keeps
 * its hue but has its lightness clamped (dark enough on a light page, light
 * enough on a dark one), and quiet text is never faded below the quiet colour,
 * which the theme already sets to pass.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = join(__dirname, '..', '..')
const globals = readFileSync(join(src, 'globals.css'), 'utf8')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === '__tests__') return []
    if (statSync(path).isDirectory()) return files(path)
    return name.endsWith('.tsx') ? [path] : []
  })
}
const portal = [
  ...files(join(src, 'components/public')),
  join(src, 'components/shared/quackback-embed-card.tsx'),
]
/** The support widget: the iframe app the embed script frames on customers' sites. */
const widget = [
  ...files(join(src, 'components/widget')),
  ...files(join(src, 'routes/widget')),
  join(src, 'routes/widget.tsx'),
]

describe('readable portal text', () => {
  it('clamps a colour drawn as text to a readable lightness, in light and in dark', () => {
    expect(globals).toMatch(
      /@utility text-readable\s*{[^}]*oklch\(from var\(--ink[^)]*\) clamp\(var\(--ink-l-min\), l, var\(--ink-l-max\)\) c h\)/
    )
    const light = globals.slice(globals.indexOf(':root {'))
    const dark = globals.slice(globals.indexOf('.dark {'))
    // 0.47, not more: a pure red or green at 0.5 falls just short on its own tint over a tinted page.
    expect(light).toMatch(/--ink-l-max:\s*0\.47\b/)
    // 0.84, not less: a coloured dark page (a deep blue) needs it lighter than a near-black one.
    expect(dark).toMatch(/--ink-l-min:\s*0\.84\b/)
  })

  it('draws vote counts and tags through it, never in their raw colour', () => {
    for (const file of portal) {
      const code = readFileSync(file, 'utf8')
      expect(code, file).not.toMatch(/color:\s*tag\.color/)
      expect(code, file).not.toMatch(/[\s'"`]text-post-card-voted[\s'"`]/)
    }
  })

  it('draws the main colour as text in its readable shade, never the button fill', () => {
    // --primary-ink is worked out per theme to read at 4.5:1 on the page and
    // its cards (lib/shared/theme/expand.ts); --primary is the button fill.
    expect(globals).toContain('--color-primary-ink: var(--primary-ink, var(--primary));')
    const routes = files(join(src, 'routes')).filter((file) => file.includes('/_portal'))
    for (const file of [...portal, ...routes, ...widget]) {
      const code = readFileSync(file, 'utf8')
      expect(code, file).not.toMatch(/(?<![\w-])(text|caret)-primary(?![-\w])/)
    }
  })

  it('sends text-primary left in shared components to the readable shade, overlays included', () => {
    // Shared components (rich text, menus, dialogs) keep text-primary, and
    // overlays portal to the body, outside the portal root. The theme writes
    // --primary-ink on the document (:root and .dark), so a document-level
    // rule reaches them in both modes; the admin, which declares no
    // --primary-ink, falls back to what it drew before.
    const rule = (selector: string, property: string, value: string) =>
      new RegExp(
        `${selector.replace(/[.()]/g, '\\$&')}\\s*{\\s*${property}:\\s*${value.replace(/[()]/g, '\\$&')};`
      )
    for (const [utility, property] of [
      ['text-primary', 'color'],
      ['fill-primary', 'fill'],
      ['stroke-primary', 'stroke'],
      ['caret-primary', 'caret-color'],
    ]) {
      expect(globals).toMatch(
        rule(`html:not(.dark) .${utility}`, property, 'var(--primary-ink, var(--accent-ink))')
      )
      expect(globals).toMatch(
        rule(`.dark .${utility}`, property, 'var(--primary-ink, var(--primary))')
      )
    }
    // Not scoped to the portal root, which overlays sit outside of.
    expect(globals).not.toMatch(/\[data-portal\]\s+\.text-primary/)
  })

  it('never fades portal text at rest below its colour (a hover or a disabled state may)', () => {
    for (const file of portal) {
      const code = readFileSync(file, 'utf8')
      expect(code, file).not.toMatch(/text-muted-foreground\/\d+/)
      expect(code, file).not.toMatch(/(?<![\w:-])text-foreground\/\d+/)
    }
  })
})
