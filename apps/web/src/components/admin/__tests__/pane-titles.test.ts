/**
 * A side pane's title heads the pane, not the page: a PageHeader inside a
 * `data-side-pane` container renders an h2, so the page keeps its one h1.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readAdminFiles, SRC_ROOT } from './admin-consistency.rules'

const PAGE_HEADER = /<PageHeader\b[^>]*?\/>|<PageHeader\b[\s\S]*?\n\s*\/>/g

describe('pane titles', () => {
  const panes = readAdminFiles().filter(({ src }) => src.includes('data-side-pane'))

  it('finds the side panes', () => {
    expect(panes.length).toBeGreaterThanOrEqual(5)
  })

  it.each(panes.map(({ file }) => file))('%s renders pane titles as h2', (file) => {
    const src = readFileSync(`${SRC_ROOT}/${file}`, 'utf8')
    for (const tag of src.match(PAGE_HEADER) ?? []) {
      expect(tag, `${file}: a pane PageHeader needs as="h2"`).toMatch(/\bas="h2"/)
    }
  })

  it('counts at least one pane PageHeader overall', () => {
    const tags = panes.flatMap(({ src }) => src.match(PAGE_HEADER) ?? [])
    expect(tags.length).toBeGreaterThanOrEqual(5)
  })
})
