// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

// The public changelog list renders an empty state when there are no entries.
// We mock the infinite query so the component takes the empty branch without a
// live data layer.
const mockUseInfiniteQuery = vi.fn()
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useInfiniteQuery: () => mockUseInfiniteQuery() }
})

vi.mock('../changelog-entry-card', () => ({
  ChangelogEntryCard: ({
    title,
    linkedPosts,
  }: {
    id: string
    title: string
    content: string
    contentJson?: unknown
    publishedAt: string
    linkedPosts: unknown[]
  }) => (
    <article>
      {title} ({linkedPosts.length} posts)
    </article>
  ),
}))

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

  it('renders loading and filtered empty states', () => {
    mockUseInfiniteQuery.mockReturnValue({
      data: undefined,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: true,
    })
    const { rerender } = render(
      <IntlProvider locale="en">
        <ChangelogListPublic />
      </IntlProvider>
    )

    expect(screen.getByText('Loading changelog...')).toBeInTheDocument()

    mockUseInfiniteQuery.mockReturnValue({
      data: { pages: [{ items: [] }] },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
    })
    rerender(
      <IntlProvider locale="en">
        <ChangelogListPublic selectedCategoryId="cat_1" />
      </IntlProvider>
    )

    expect(screen.getByText('No updates for this filter')).toBeInTheDocument()
    expect(screen.getByText('Try selecting a different category or product.')).toBeInTheDocument()
  })

  it('renders entries, visible filters, and load-more actions', () => {
    const fetchNextPage = vi.fn()
    const onCategoryChange = vi.fn()
    const onProductChange = vi.fn()
    mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [
          {
            items: [
              {
                id: 'changelog_1',
                title: 'Widget launch',
                content: 'Launch notes',
                contentJson: null,
                publishedAt: '2026-06-20T10:00:00.000Z',
                linkedPosts: [{ id: 'post_1' }],
              },
            ],
          },
        ],
      },
      fetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false,
      isLoading: false,
    })
    const { rerender } = render(
      <IntlProvider locale="en">
        <ChangelogListPublic
          allowedCategoryIds={['cat_1']}
          allowedProductIds={['prod_1']}
          availableCategories={[
            { id: 'cat_1', name: 'Features', slug: 'features', color: '#22c55e' },
            { id: 'cat_2', name: 'Hidden', slug: 'hidden' },
          ]}
          availableProducts={[
            { id: 'prod_1', name: 'Widget', slug: 'widget' },
            { id: 'prod_2', name: 'Hidden product', slug: 'hidden-product' },
          ]}
          selectedCategoryId="cat_1"
          selectedProductId="prod_1"
          onCategoryChange={onCategoryChange}
          onProductChange={onProductChange}
        />
      </IntlProvider>
    )

    expect(screen.getByText('Widget launch (1 posts)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Features' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hidden' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Widget' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hidden product' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(fetchNextPage).toHaveBeenCalled()

    mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [
          {
            items: [
              {
                id: 'changelog_2',
                title: 'Loading more entry',
                content: '',
                contentJson: null,
                publishedAt: '2026-06-20T10:00:00.000Z',
                linkedPosts: [],
              },
            ],
          },
        ],
      },
      fetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: true,
      isLoading: false,
    })
    rerender(
      <IntlProvider locale="en">
        <ChangelogListPublic
          onCategoryChange={onCategoryChange}
          onProductChange={onProductChange}
        />
      </IntlProvider>
    )

    expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled()
  })
})
