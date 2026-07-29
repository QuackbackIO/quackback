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
  it('renders the leading entries as oversized headline numbers, distinct from the row title size', async () => {
    hoisted.topViewedChangelogsFn.mockResolvedValue(ENTRIES)
    renderWithClient(<ChangelogTopViewed />)

    const headline = await screen.findByText('5,000')
    // Headline metrics use a large, bold, tabular-nums treatment so the eye
    // lands on the number before reading any row title.
    expect(headline.className).toMatch(/text-2xl|text-3xl/)
    expect(headline.className).toMatch(/font-bold/)
    expect(headline.className).toMatch(/tabular-nums/)

    const title = screen.getByText('Fastest entry')
    expect(title.className).not.toMatch(/text-2xl|text-3xl/)
  })

  it('keeps the remaining entries as compact detail rows below the headline tier', async () => {
    hoisted.topViewedChangelogsFn.mockResolvedValue(ENTRIES)
    renderWithClient(<ChangelogTopViewed />)

    await screen.findByText('5,000')
    expect(screen.getByText('Fourth entry')).toBeInTheDocument()
    expect(screen.getByText('Fifth entry')).toBeInTheDocument()
    // Detail rows still show their view counts, just not at headline size.
    const detailCount = screen.getByText('400')
    expect(detailCount.className).not.toMatch(/text-2xl|text-3xl/)
  })

  it('renders nothing while loading or when there is no data', () => {
    hoisted.topViewedChangelogsFn.mockResolvedValue([])
    const { container } = renderWithClient(<ChangelogTopViewed />)
    expect(container).toBeEmptyDOMElement()
  })
})
