// @vitest-environment happy-dom
/**
 * The search-terms table ranks visitor queries by volume and flags the ones
 * that returned nothing, so an admin can spot content gaps at a glance.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const hoisted = vi.hoisted(() => ({
  listSearchTermsFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/help-center', () => ({
  listSearchTermsFn: hoisted.listSearchTermsFn,
}))

import { SearchTermsTable } from '../search-terms-table'

const ROWS = [
  {
    term: 'billing',
    normalizedQuery: 'billing',
    searches: 42,
    zeroResultSearches: 0,
    lastSearchedAt: '2026-07-30T10:00:00.000Z',
  },
  {
    term: 'sso provisioning',
    normalizedQuery: 'sso provisioning',
    searches: 17,
    zeroResultSearches: 17,
    lastSearchedAt: '2026-07-29T09:00:00.000Z',
  },
  {
    term: 'custom domain',
    normalizedQuery: 'custom domain',
    searches: 9,
    zeroResultSearches: 3,
    lastSearchedAt: '2026-07-28T08:00:00.000Z',
  },
]

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('SearchTermsTable', () => {
  afterEach(() => {
    cleanup()
    hoisted.listSearchTermsFn.mockClear()
  })

  it('lists the most-searched terms with their volume', async () => {
    hoisted.listSearchTermsFn.mockResolvedValue(ROWS)
    renderWithClient(<SearchTermsTable />)
    expect(await screen.findByText('billing')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('sso provisioning')).toBeTruthy()
  })

  it('flags terms whose searches all returned no results', async () => {
    hoisted.listSearchTermsFn.mockResolvedValue(ROWS)
    renderWithClient(<SearchTermsTable />)
    await screen.findByText('sso provisioning')
    const badge = screen.getByTestId('search-term-no-results-sso provisioning')
    expect(badge.textContent).toMatch(/no results/i)
    // A term that always hits carries no flag.
    expect(screen.queryByTestId('search-term-no-results-billing')).toBeNull()
  })

  it('shows the zero-result count per term', async () => {
    hoisted.listSearchTermsFn.mockResolvedValue(ROWS)
    renderWithClient(<SearchTermsTable />)
    await screen.findByText('custom domain')
    expect(screen.getByTestId('search-term-misses-custom domain').textContent).toContain('3')
  })

  it('renders an empty state before any searches are recorded', async () => {
    hoisted.listSearchTermsFn.mockResolvedValue([])
    renderWithClient(<SearchTermsTable />)
    expect(await screen.findByText(/no searches yet/i)).toBeTruthy()
  })
})
