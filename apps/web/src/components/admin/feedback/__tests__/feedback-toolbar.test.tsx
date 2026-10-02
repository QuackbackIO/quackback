// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InboxFilters } from '@/components/admin/feedback/use-inbox-filters'

vi.mock('@/components/admin/feedback/inbox-empty-state', () => ({
  InboxEmptyState: () => null,
}))

const { FeedbackTableView } = await import('../table/feedback-table-view')
const { CreatePostDialog } = await import('../create-post-dialog')

afterEach(cleanup)

function renderTable(headerAction?: React.ReactNode, headerFilters?: React.ReactNode) {
  const filters: InboxFilters = { sort: 'newest' }
  return render(
    <FeedbackTableView
      posts={[]}
      statuses={[]}
      boards={[]}
      tags={[]}
      members={[]}
      filters={filters}
      onFiltersChange={vi.fn()}
      hasMore={false}
      isLoading={false}
      isLoadingMore={false}
      onNavigateToPost={vi.fn()}
      onLoadMore={vi.fn()}
      hasActiveFilters={false}
      onClearFilters={vi.fn()}
      onToggleStatus={vi.fn()}
      onToggleBoard={vi.fn()}
      headerFilters={headerFilters}
      headerAction={headerAction}
    />
  )
}

describe('feedback toolbar', () => {
  it('puts the Filter control in the toolbar row with the header filters and no Add filter line', () => {
    renderTable(<button>New post</button>, <button>Views</button>)
    const toolbar = document.querySelector('[data-slot="admin-list-search"]')!.parentElement!
    const labels = Array.from(toolbar.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(labels).toEqual(['Sort: Newest', 'Filter', 'Views', 'New post'])
    expect(screen.queryByText('Add filter')).toBeNull()
  })

  it('offers the four sort choices in sentence case', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderTable()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sort: Newest' }))
    expect(screen.getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual([
      'Newest',
      'Oldest',
      'Top votes',
      'Priority',
    ])
  })

  it('labels the create trigger New post', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CreatePostDialog
          boards={[]}
          tags={[]}
          statuses={[]}
          currentUser={{ name: 'A', email: 'a@b.c', principalId: 'principal_1' } as never}
        />
      </QueryClientProvider>
    )
    expect(screen.getByRole('button', { name: 'New post' })).toBeInTheDocument()
  })
})
