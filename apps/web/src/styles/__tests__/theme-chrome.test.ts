import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { railControlClass } from '@/components/admin/rail-item'

const dir = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(dir, '../../globals.css'), 'utf8')
const adminSource = readFileSync(join(dir, '../../routes/admin.tsx'), 'utf8')

/** The declaration block that follows the first occurrence of a selector. */
function block(selector: string): string {
  const start = css.indexOf(`\n${selector}`)
  expect(start, `selector not found: ${selector}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

const lightTokens = block('  :root {')
const darkTokens = block('  .dark {')

describe('theme chrome tokens', () => {
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

describe('theme chrome rules', () => {
  it('fills the active pane row flat, with the yellow icon and no pill', () => {
    const active = block(`[data-side-pane] .nav-row.bg-muted,`)
    expect(active).toContain('background: var(--chrome-pane-active-background)')
    expect(active).toContain('font-weight: 500')
    expect(active).not.toContain('box-shadow')
    expect(active).not.toContain('border-color')
    expect(block(`[data-side-pane] .nav-row.bg-muted > svg,`)).toContain(
      'color: var(--chrome-active-icon)'
    )
  })

  it('sizes pane rows at 32px with 13.5px text and 8px corners', () => {
    const row = block('[data-side-pane] .nav-row {')
    expect(row).toContain('min-height: 32px')
    expect(row).toContain('font-size: 13.5px')
    expect(row).toContain('border-radius: var(--radius-field)')
  })

  it('labels panes in 12px semibold on the label token', () => {
    const label = block(`[data-side-pane] .nav-section {`)
    expect(label).toContain('font-size: 12px')
    expect(label).toContain('font-weight: 600')
    expect(label).toContain('color: var(--chrome-label)')
  })

  it('rings focused pane rows in the focus token', () => {
    const ring = block('[data-side-pane] .nav-row:focus-visible {')
    expect(ring).toContain('outline: 2px solid var(--chrome-focus)')
    expect(ring).toContain('outline-offset: 1px')
  })
})

describe('admin chrome surfaces', () => {
  const tokens = (classes: string) => classes.split(/\s+/)

  it('draws rail rows at 32px with 13.5px text and 8px corners on the chrome ground', () => {
    const row = tokens(railControlClass())
    expect(row).toEqual(
      expect.arrayContaining(['min-h-8', 'rounded-field', 'text-chrome-rail-text'])
    )
    expect(row.some((t) => t.startsWith('text-[13.5px]'))).toBe(true)
    expect(row).toEqual(expect.arrayContaining(['focus-visible:outline-chrome-focus']))
  })

  it('presses the active rail row in, with the yellow icon and no border colour', () => {
    const active = tokens(railControlClass(true))
    expect(active).toEqual(
      expect.arrayContaining([
        'bg-chrome-active',
        'shadow-chrome-active',
        'font-medium',
        'text-chrome-active-text',
        '[&>svg]:text-chrome-active-icon',
      ])
    )
    expect(active.some((t) => t.startsWith('border-chrome'))).toBe(false)
  })

  it('fills the screen with the page sheet on phones and insets it from the small breakpoint up', () => {
    const shell = adminSource.match(/data-admin-shell=""\s+className="([^"]+)"/)![1]!
    const canvas = adminSource.match(/data-admin-canvas=""\s+className="([^"]+)"/)![1]!
    expect(tokens(shell)).toEqual(
      expect.arrayContaining(['bg-chrome', 'p-0', 'sm:py-2', 'sm:pe-2'])
    )
    expect(tokens(canvas)).toEqual(
      expect.arrayContaining([
        'bg-background',
        'sm:rounded-[14px]',
        'sm:border',
        'sm:border-chrome-hairline',
        'sm:shadow-chrome-canvas',
      ])
    )
    // Logical sides only, so RTL mirrors the sheet.
    expect(`${shell} ${canvas}`).not.toMatch(/\b(?:sm:)?p[lr]-/)
  })
})

describe('theme dark sheet', () => {
  const sheet = block(`.dark [data-admin-canvas] {`)

  it('defines the sheet and card surfaces on the admin canvas', () => {
    expect(sheet).toContain('--background: #131316;')
    expect(sheet).toContain('--card: #18181b;')
    expect(sheet).toContain('--popover: #18181b;')
    expect(sheet).toContain('--muted: #1f1f23;')
    expect(sheet).toContain('--border: #27272a;')
  })

  it('applies the same sheet tokens at the document level while an admin shell is mounted', () => {
    const doc = block(`.dark:has([data-admin-shell]),`)
    expect(doc).toBe(sheet)
  })

  it('touches no portal or widget selector with the sheet tokens', () => {
    const start = css.indexOf(`\n.dark:has([data-admin-shell]),`)
    const header = css.slice(start, css.indexOf('{', start))
    expect(header.match(/\n\.dark/g)).toHaveLength(2)
    expect(header).not.toMatch(/portal|widget/i)
    expect(css).not.toMatch(/\.dark:not\(:has/)
  })

  it('keeps the portal and widget on the document-level dark tokens, apart from the admin sheet', () => {
    expect(darkTokens).toContain('--background: #0a0a0a;')
    expect(darkTokens).toContain('--card: #0a0a0a;')
    expect(darkTokens).toContain('--popover: #101010;')
    expect(darkTokens).toContain('--muted: #181818;')
    expect(darkTokens).toContain('--border: #262626;')
    expect(darkTokens).not.toContain('#131316')
  })
})
