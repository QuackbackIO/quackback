// @vitest-environment happy-dom
/**
 * Ask AI's first suggestions follow where the person is: the picked part's
 * own examples, else the page open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: { available: true } }),
  useQuery: () => ({ data: undefined }),
}))
vi.mock('@/lib/server/functions/site-capture', () => ({ siteCaptureUsageFn: vi.fn() }))
vi.mock('@/lib/client/queries/portal-design', () => ({
  portalDesignQueries: { aiStatus: () => ({}) },
}))
vi.mock('@/lib/client/image-palette', () => ({}))
vi.mock('@/components/admin/settings/appearance/ask-ai-panel', () => ({
  AskAiPanel: () => null,
  PaletteSwatches: () => null,
}))

const { DesignerAi } = await import('../designer-ai')
const { defaultDesign } = await import('@/lib/shared/design/schema')

afterEach(cleanup)

function matched() {
  const design = defaultDesign()
  design.brand.matchedAt = '2026-11-07T12:00:00.000Z'
  design.nav.home.on = true
  return design
}

function starters(page: 'home' | 'roadmap', selection: string | null, name: string | null) {
  render(
    <DesignerAi
      ai={{ busy: false, limited: null, ask: vi.fn(), turns: [] } as never}
      draft={{ design: matched() } as never}
      selection={selection as never}
      selectionName={name}
      page={page}
      pageName={page === 'home' ? 'Home' : 'Roadmap'}
      update={vi.fn()}
      onClearSelection={vi.fn()}
      onCollapse={vi.fn()}
    />
  )
  return within(screen.getByRole('list', { name: 'Suggestions' }))
    .getAllByRole('button')
    .map((button) => button.textContent)
}

describe('Ask AI’s starters', () => {
  it('offers the picked part’s examples', () => {
    expect(starters('home', 'hero', 'Hero')).toEqual([
      'Make the hero louder',
      'Give the hero more room and a dotted pattern',
      'Just the headline up top, no post box there',
    ])
  })

  it('keeps to the page open when nothing is picked', () => {
    const shown = starters('roadmap', null, null)
    expect(shown[0]).toBe('Lay the roadmap out in columns')
    expect(shown).not.toContain('Show the roadmap on Home')
  })
})
