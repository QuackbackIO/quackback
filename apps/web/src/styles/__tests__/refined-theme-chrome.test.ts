import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(dir, '../refined-theme.css'), 'utf8')

/** The declaration block that follows the first occurrence of a selector. */
function block(selector: string): string {
  const start = css.indexOf(`\n${selector}`)
  expect(start, `selector not found: ${selector}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

const R = "[data-visual-theme='refined']"
const lightTokens = block(":root:where([data-visual-theme='refined'])")
const darkTokens = block(".dark:where([data-visual-theme='refined'])")

describe('refined theme chrome tokens', () => {
  it.each([
    ['--chrome-background', '#f4f4f5', '#09090b'],
    ['--chrome-hairline', '#e4e4e7', '#232327'],
    ['--chrome-rail-text', '#52525b', '#a1a1aa'],
    ['--chrome-pane-text', '#3f3f46', '#d4d4d8'],
    ['--chrome-icon', '#8b8b93', '#71717a'],
    ['--chrome-label', '#5f5f68', '#8b8b94'],
    ['--chrome-hover', 'rgba(0, 0, 0, 0.04)', 'rgba(255, 255, 255, 0.04)'],
    ['--chrome-active-background', '#e4e4e7', '#18181b'],
    [
      '--chrome-active-shadow',
      'inset 0 1px 2px rgba(0, 0, 0, 0.1)',
      'inset 0 1px 2px rgba(0, 0, 0, 0.6)',
    ],
    ['--chrome-active-text', '#09090b', '#fafafa'],
    ['--chrome-active-icon', '#9a6c00', '#ffcf20'],
    ['--chrome-pane-active-background', '#f4f4f5', '#1f1f23'],
    ['--chrome-focus', '#9a6c00', '#ffcf20'],
  ])('%s is %s in light and %s in dark', (name, light, dark) => {
    expect(lightTokens).toContain(`${name}: ${light};`)
    expect(darkTokens).toContain(`${name}: ${dark};`)
  })
})

describe('refined theme chrome rules', () => {
  it('puts only the rail on the chrome field; panes sit on the sheet', () => {
    expect(block(`${R} [data-admin-rail] {`)).toContain('background: var(--chrome-background)')
    const pane = block(`${R} [data-side-pane] {`)
    expect(pane).toContain('background: var(--background)')
    expect(pane).toContain('border-color: var(--chrome-hairline)')
  })

  it('raises the active rail item into an outlined pill with the yellow icon', () => {
    const active = block(`${R} [data-admin-rail-item][data-active] {`)
    expect(active).toContain('background: var(--chrome-active-background)')
    expect(active).not.toContain('border-color')
    expect(active).toContain('box-shadow: var(--chrome-active-shadow)')
    expect(active).toContain('font-weight: 500')
    expect(block(`${R} [data-admin-rail-item][data-active] > svg {`)).toContain(
      'color: var(--chrome-active-icon)'
    )
  })

  it('fills the active pane row flat, with the yellow icon and no pill', () => {
    const active = block(`${R} [data-side-pane] .nav-row.bg-muted,`)
    expect(active).toContain('background: var(--chrome-pane-active-background)')
    expect(active).toContain('font-weight: 500')
    expect(active).not.toContain('box-shadow')
    expect(active).not.toContain('border-color')
    expect(block(`${R} [data-side-pane] .nav-row.bg-muted > svg,`)).toContain(
      'color: var(--chrome-active-icon)'
    )
  })

  it('sizes rail and pane rows at 32px with 13.5px text and 8px corners', () => {
    for (const selector of [`${R} [data-admin-rail-item] {`, `${R} [data-side-pane] .nav-row {`]) {
      const row = block(selector)
      expect(row).toContain('min-height: 32px')
      expect(row).toContain('font-size: 13.5px')
      expect(row).toContain('border-radius: var(--radius-field)')
    }
  })

  it('labels panes in 12px semibold on the label token', () => {
    const label = block(`${R} [data-side-pane] .nav-section {`)
    expect(label).toContain('font-size: 12px')
    expect(label).toContain('font-weight: 600')
    expect(label).toContain('color: var(--chrome-label)')
  })

  it('rings focused rail and pane rows in the focus token', () => {
    const ring = block(`${R} [data-admin-rail-item]:focus-visible,`)
    expect(ring).toContain('outline: 2px solid var(--chrome-focus)')
    expect(ring).toContain('outline-offset: 1px')
  })

  it('fills the screen with the page sheet on phones', () => {
    expect(block(`${R} [data-admin-shell] {`)).toContain('padding: 0')
    const canvas = block(`${R} [data-admin-canvas] {`)
    expect(canvas).toContain('border-radius: 0')
    expect(canvas).toContain('background: var(--background)')
  })

  it('insets the page sheet on the chrome ground from the small breakpoint up', () => {
    expect(block(`${R} [data-admin-shell] {`)).toContain('background: var(--chrome-background)')
    const media = css.slice(css.indexOf('@media (min-width: 640px)'))
    const shell = media.slice(media.indexOf('[data-admin-shell]'))
    expect(shell.slice(0, shell.indexOf('}'))).toContain('padding: 8px 8px 8px 0')
    const canvas = media.slice(media.indexOf('[data-admin-canvas]'))
    const canvasBlock = canvas.slice(0, canvas.indexOf('}'))
    expect(canvasBlock).toContain('border: 1px solid var(--chrome-hairline)')
    expect(canvasBlock).toContain('border-radius: 14px')
    expect(block(`${R} [data-admin-rail] {\n  border-right`)).toContain('border-right: 0')
  })
})

describe('refined theme dark sheet', () => {
  const D = ".dark[data-visual-theme='refined']"
  const sheet = block(`${D} [data-admin-canvas] {`)

  it('defines the sheet and card surfaces on the admin canvas', () => {
    expect(sheet).toContain('--background: #131316;')
    expect(sheet).toContain('--card: #18181b;')
    expect(sheet).toContain('--popover: #18181b;')
    expect(sheet).toContain('--muted: #1f1f23;')
    expect(sheet).toContain('--border: #27272a;')
  })

  it('applies the same sheet tokens at the document level while an admin shell is mounted', () => {
    const doc = block(`${D}:has([data-admin-shell]),`)
    expect(doc).toBe(sheet)
  })

  it('touches no portal or widget selector with the sheet tokens', () => {
    const start = css.indexOf(`\n${D}:has([data-admin-shell]),`)
    const header = css.slice(start, css.indexOf('{', start))
    expect(header.match(/\n\.dark/g)).toHaveLength(2)
    expect(header).not.toMatch(/portal|widget/i)
    expect(css).not.toMatch(/\.dark\[data-visual-theme='refined'\]:not\(:has/)
  })

  it('leaves the document-level dark tokens, and so the portal and widget, unchanged', () => {
    expect(darkTokens).toContain('--background: #0a0a0a;')
    expect(darkTokens).toContain('--card: #0a0a0a;')
    expect(darkTokens).toContain('--popover: #101010;')
    expect(darkTokens).toContain('--muted: #181818;')
    expect(darkTokens).toContain('--border: #262626;')
    expect(darkTokens).not.toContain('#131316')
  })

  it('scopes card surfaces to the admin canvas', () => {
    expect(block(`${R} [data-admin-canvas] [data-slot='card'],`)).toContain(
      'background: var(--card)'
    )
  })
})
