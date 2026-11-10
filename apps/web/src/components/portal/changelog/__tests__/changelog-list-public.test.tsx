// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

// The public changelog list renders an empty state when there are no entries.
// We mock the infinite query (entries) and the plain query (category filter
// chips) so the component takes the empty branch without a live data layer
// or a QueryClientProvider.
const mockUseInfiniteQuery = vi.fn()
const mockUseQuery = vi.fn(() => ({ data: [] }))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useInfiniteQuery: () => mockUseInfiniteQuery(),
    useQuery: () => mockUseQuery(),
  }
})

import { ChangelogListPublic } from '../changelog-list-public'

function renderEmpty(messages: Record<string, string>) {
  mockUseInfiniteQuery.mockReturnValue({
    data: { pages: [{ items: [] }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  })
  return render(
    <IntlProvider locale="fr" defaultLocale="en" messages={messages}>
      <ChangelogListPublic />
    </IntlProvider>
  )
}

describe('ChangelogListPublic empty state', () => {
  it('renders the localized empty-state copy instead of hardcoded English', () => {
    renderEmpty({
      'portal.changelog.empty.title': 'Aucune actualité pour le moment',
      'portal.changelog.empty.description': 'Revenez bientôt pour les dernières nouveautés.',
    })

    expect(screen.getByText('Aucune actualité pour le moment')).toBeInTheDocument()
    expect(screen.getByText('Revenez bientôt pour les dernières nouveautés.')).toBeInTheDocument()
    expect(screen.queryByText('No updates yet')).not.toBeInTheDocument()
  })
})

describe('ChangelogListPublic while its entries load', () => {
  function renderLoading(layout?: 'timeline' | 'cards' | 'compact') {
    mockUseInfiniteQuery.mockReturnValue({
      data: undefined,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: true,
    })
    return render(
      <IntlProvider locale="en">
        <ChangelogListPublic entries={layout} />
      </IntlProvider>
    )
  }

  it('holds room for its first entries in their layout, and says it is loading to a screen reader', () => {
    const { container } = renderLoading('timeline')
    const held = container.querySelector('[data-qb-skeleton=changelog]')!
    expect(held.getAttribute('aria-hidden')).toBe('true')
    expect(held.children).toHaveLength(3)
    // Laid out as the entries will be: a timeline's rules and its rows' padding.
    expect(held.className).toContain('divide-y')
    expect(held.children[0]!.className).toContain('py-10')
    expect(screen.getByText('Loading changelog...').className).toContain('sr-only')
  })

  it('holds a compact row as a date and a title, as the compact list draws them', () => {
    const { container } = renderLoading('compact')
    const row = container.querySelector('[data-qb-skeleton=changelog] > div')!
    expect(row.children).toHaveLength(2)
  })
})
