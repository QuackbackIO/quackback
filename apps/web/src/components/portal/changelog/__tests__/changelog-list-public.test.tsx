// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
  function renderLoading(entries?: 'timeline' | 'cards' | 'compact') {
    mockUseInfiniteQuery.mockReturnValue({
      data: undefined,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: true,
    })
    const { container } = render(
      <IntlProvider locale="en">
        <ChangelogListPublic entries={entries} />
      </IntlProvider>
    )
    return container.querySelector('[aria-busy=true]')!
  }

  it('keeps a screen of room in the placeholder look, and says it is loading to a screen reader', () => {
    const busy = renderLoading()
    // A screen of room, so the footer stays below until the entries arrive.
    expect(busy.className.split(' ')).toContain('min-h-screen')
    expect(busy.querySelector('.qb-skeleton')).not.toBeNull()
    expect(screen.getByText('Loading changelog...').className).toContain('sr-only')
  })

  it('keeps half a screen for compact rows, which a page of fills no more', () => {
    expect(renderLoading('compact').className.split(' ')).toContain('min-h-[50vh]')
    cleanup()
    expect(renderLoading('cards').className.split(' ')).toContain('min-h-screen')
  })
})
