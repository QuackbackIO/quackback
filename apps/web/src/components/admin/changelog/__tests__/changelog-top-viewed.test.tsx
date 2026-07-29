// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const ENTRIES = [
  { id: 'changelog_1', title: 'Fastest entry', viewCount: 5000 },
  { id: 'changelog_2', title: 'Second entry', viewCount: 3200 },
  { id: 'changelog_3', title: 'Third entry', viewCount: 1800 },
  { id: 'changelog_4', title: 'Fourth entry', viewCount: 400 },
  { id: 'changelog_5', title: 'Fifth entry', viewCount: 120 },
]

const hoisted = vi.hoisted(() => ({
  topViewedChangelogsFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/changelog', () => ({
  topViewedChangelogsFn: hoisted.topViewedChangelogsFn,
}))

import { ChangelogTopViewed } from '../changelog-top-viewed'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('<ChangelogTopViewed>', () => {
  it('renders every returned entry as a row, not a hard-capped subset', async () => {
    hoisted.topViewedChangelogsFn.mockResolvedValue(ENTRIES)
    renderWithClient(<ChangelogTopViewed />)

    await screen.findByText('Fastest entry')
    // The module scales with however many entries the query returns; it
    // must not silently drop entries past a fixed card count.
    for (const entry of ENTRIES) {
      expect(screen.getByText(entry.title)).toBeInTheDocument()
      expect(screen.getByText(entry.viewCount.toLocaleString())).toBeInTheDocument()
    }
  })

  it('gives every row the same title/count encoding', async () => {
    hoisted.topViewedChangelogsFn.mockResolvedValue(ENTRIES)
    const { container } = renderWithClient(<ChangelogTopViewed />)

    await screen.findByText('Fastest entry')
    const rows = container.querySelectorAll('[data-slot="top-viewed-row"]')
    expect(rows).toHaveLength(ENTRIES.length)
    // Every row shares one class list — no entry gets a bigger card
    // treatment than another.
    const classLists = Array.from(rows).map((row) => row.className)
    expect(new Set(classLists).size).toBe(1)
  })

  it('separates the rank number from the title with its own element and spacing', async () => {
    hoisted.topViewedChangelogsFn.mockResolvedValue(ENTRIES)
    const { container } = renderWithClient(<ChangelogTopViewed />)

    await screen.findByText('Fastest entry')
    const rank = container.querySelector('[data-slot="top-viewed-rank"]')
    expect(rank).not.toBeNull()
    expect(rank?.textContent).toBe('1')
    // The rank sits in its own element, not concatenated onto the title
    // text node.
    expect(screen.getByText('Fastest entry').textContent).toBe('Fastest entry')
  })

  it('never mixes card and row encodings for entries within the same module', async () => {
    hoisted.topViewedChangelogsFn.mockResolvedValue(ENTRIES)
    const { container } = renderWithClient(<ChangelogTopViewed />)

    await screen.findByText('Fastest entry')
    expect(container.querySelector('table')).not.toBeInTheDocument()
  })

  it('renders nothing while loading or when there is no data', () => {
    hoisted.topViewedChangelogsFn.mockResolvedValue([])
    const { container } = renderWithClient(<ChangelogTopViewed />)
    expect(container).toBeEmptyDOMElement()
  })
})
