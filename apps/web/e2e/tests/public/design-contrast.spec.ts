/**
 * Every surface a design draws reads as Chromium paints it. Each design
 * fixture (src/lib/shared/design/__tests__/fixtures), as it is and with its
 * Home blocks tinted in each brand colour, is rendered from its own design
 * CSS onto a page holding each surface the portal draws (the page, cards,
 * raised parts, buttons, tinted and brand-colour blocks, tinted vote boxes,
 * the header and the footer's credit), each with the text, secondary text
 * and links it carries. The page then measures every run of text at desktop
 * and phone widths, in each mode the design shows.
 *
 * Needs no server: the page is set from the CSS the resolver writes. The
 * numeric check of the same pairs is surface-contrast.test.ts; this one
 * proves the browser paints what the solver measured (color-mix in oklch).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { layoutAttributes } from '../../../src/lib/shared/design/components'
import { designRoles } from '../../../src/lib/shared/design/colour-roles'
import { renderDesignCss, resolveDesign } from '../../../src/lib/shared/design/resolve'
import { portalDesign, type PortalDesign } from '../../../src/lib/shared/design/schema'
import { blockTintCss } from '../../../src/lib/shared/design/tints'
import { audit, describeFailures } from '../../utils/a11y-audit'

const FIXTURES = join(import.meta.dirname, '../../../src/lib/shared/design/__tests__/fixtures')

const fixtures = [FIXTURES, join(FIXTURES, 'no-overrides')].flatMap((dir) =>
  readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => ({
      name: file.replace(/\.json$/, ''),
      doc: portalDesign.parse(JSON.parse(readFileSync(join(dir, file), 'utf8'))),
    }))
)

/**
 * The fixture with a tinted block and a brand-colour block in each of its
 * colours, and vote boxes tinted with the second colour.
 */
function tinted(doc: PortalDesign): PortalDesign {
  const out = structuredClone(doc)
  out.pages.home.blocks = designRoles(doc).flatMap((colour, i) =>
    (['tint', 'brand'] as const).map((tone, j) => ({
      id: `${tone}-${i}`,
      type: 'links',
      links: [],
      look: { tone, colour },
      grid: { x: 0, y: i * 2 + j, w: 12, h: 1 },
    }))
  ) as PortalDesign['pages']['home']['blocks']
  out.layout.tint = 'support'
  return out
}

const words = (extra = '') => `
  <p${extra}>Text on it</p>
  <p style="color: var(--muted-foreground)">Secondary text on it</p>
  <a href="#" style="color: var(--qb-accent-text)">See all updates</a>`

const fillOf = (role: string) =>
  role === 'accent'
    ? 'var(--qb-accent, var(--primary))'
    : `var(--qb-role-${role}, var(--qb-accent))`
const inkOf = (role: string) =>
  role === 'accent'
    ? 'var(--qb-on-accent, var(--primary-foreground))'
    : `var(--qb-on-role-${role}, var(--qb-on-accent))`

/** A page holding every surface the design draws, each with what sits on it. */
function page(doc: PortalDesign, mode: 'light' | 'dark'): string {
  const css = renderDesignCss(resolveDesign(doc))
  const attributes = Object.entries(layoutAttributes(doc))
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')
  const toned = (tone: string) => [
    ...new Set(
      doc.pages.home.blocks
        .filter((block) => block.look?.tone === tone)
        .map((block) => block.look?.colour ?? 'accent')
    ),
  ]
  return `<!doctype html>
<html lang="en" data-portal-theme class="${mode}" ${attributes}>
<head><title>Surfaces</title>
<style>${css}</style>
<style>
  body { margin: 0; padding: 16px; font: 14px/1.4 system-ui, sans-serif; background: var(--background); color: var(--foreground); }
  section, header, footer, .card { padding: 12px; margin-block: 8px; border-radius: 8px; }
  .card { background: var(--card); }
  .raised { background: var(--muted); }
  p { margin: 0 0 4px; }
</style></head>
<body>
  <header class="portal-header" style="background: var(--header-background); color: var(--header-foreground)">
    <span>Acme</span> <a href="#" style="color: var(--nav-inactive-color)">Feedback</a>
  </header>
  <main>
    <section>${words()}</section>
    <div class="card">${words()}</div>
    <div class="raised"><p>Text on it</p></div>
    <button style="background: var(--primary); color: var(--primary-foreground); border: 0; padding: 8px 12px">Submit</button>
    ${toned('tint')
      .map(
        (role) =>
          `<section data-qb-tone="tint" style="background: ${blockTintCss(fillOf(role))}">${words()}</section>`
      )
      .join('')}
    ${toned('brand')
      .map(
        (
          role
        ) => `<section data-qb-tone="brand" style="--qb-tone-fill: ${fillOf(role)}; --qb-tone-ink: ${inkOf(role)}; background: var(--qb-tone-fill); color: var(--qb-tone-ink)">
          <div><p style="color: var(--foreground)">Text on it</p><a href="#" style="color: var(--qb-accent-text)">See all</a></div></section>`
      )
      .join('')}
    <div class="card"><span data-qb-part="vote-button" style="display: inline-block; padding: 4px 8px; background: var(--qb-support-tint, var(--muted)); color: var(--foreground)">12</span></div>
  </main>
  <footer style="background: var(--background)">
    <a href="#" style="display: inline-block; padding: 4px 10px; font-size: 12px; background: color-mix(in oklab, var(--muted) 50%, transparent); color: var(--muted-foreground)">Powered by Quackback</a>
  </footer>
</body></html>`
}

const modes = (doc: PortalDesign) =>
  doc.mode === 'light'
    ? (['light'] as const)
    : doc.mode === 'dark'
      ? (['dark'] as const)
      : (['light', 'dark'] as const)

test.describe('every surface a design draws, as Chromium paints it', () => {
  test('has fixtures', () => expect(fixtures.length).toBeGreaterThanOrEqual(12))

  for (const { name, doc } of fixtures)
    for (const [label, design] of [
      [name, doc],
      [`${name}, tinted`, tinted(doc)],
    ] as const)
      for (const mode of modes(design))
        test(`${label} in ${mode}: every text reads`, async ({ page: tab }) => {
          const html = page(design, mode)
          for (const width of [1280, 375]) {
            await tab.setViewportSize({ width, height: 2000 })
            await tab.setContent(html)
            const failures = await audit(tab, { type: false, targets: false })
            expect(describeFailures(failures), `${width}px`).toEqual([])
          }
        })
})
