import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../refined-theme.css'),
  'utf8'
)

describe('refined theme radius', () => {
  it('keeps pills on compact controls only', () => {
    expect(css).toContain("[data-slot='button'] {\n  border-radius: var(--radius-item);")
    expect(css).toContain("[data-slot='badge'] {\n  border-radius: var(--radius-item);")
    expect(css).toContain(
      "[data-slot='tabs'][data-variant='pill'] [data-slot='tabs-trigger'] {\n  border-radius: var(--radius-item);"
    )
  })

  it('does not pill banners, tiles, or full-width rows', () => {
    expect(css).not.toContain('[data-settings-card] .rounded-lg.border')
    expect(css).toContain(
      "[data-slot='alert'],\n[data-visual-theme='refined'] [data-slot='warning-box']"
    )
    expect(css).toContain(
      "[data-slot='alert'],\n[data-visual-theme='refined'] [data-slot='warning-box'] {\n  border-radius: var(--radius-field);"
    )
    expect(css).toContain('[data-settings-tile] {\n  border-radius: var(--radius-panel);')
    expect(css).toContain('.nav-row {\n  border-radius: var(--radius-field);')
    expect(css).toContain('[data-admin-rail-item] {\n  border-radius: var(--radius-field);')
    expect(css).toContain("[data-slot='tooltip-content'] {\n  border-radius: 0.375rem;")
    expect(css).toContain("[data-slot='dropdown-menu-item'],")
    expect(css).toMatch(/\[data-slot='command-item'\] \{\n  border-radius: var\(--radius-field\);/)
  })
})
