// @vitest-environment happy-dom
/**
 * The Has duplicates filter (FBA-I-12) lists only posts with a pending merge
 * suggestion. When no loaded post has one, that is "nothing matches", not
 * "skip the filter"; while the counts are still loading it lists nothing yet.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { PostId } from '@quackback/ids'
import type { PostListItem } from '@/lib/shared/db-types'

vi.mock('@/components/public/post-card', () => ({
  PostCard: ({ title }: { title: string }) => <div data-testid="row">{title}</div>,
}))
vi.mock('@/components/admin/feedback/inbox-empty-state', () => ({
  InboxEmptyState: ({ type }: { type: string }) => <p>empty: {type}</p>,
}))
vi.mock('@/components/admin/feedback/active-filters-bar', () => ({
  AddFilterButton: () => null,
  ActiveFiltersBar: () => null,
}))

const { FeedbackTableView } = await import('../feedback-table-view')
const { mergeDuplicateCounts } = await import('../../duplicate-counts')

function post(id: string, title: string): PostListItem {
  return {
    id: id as PostId,
    title,
    content: null,
    statusId: null,
    voteCount: 0,
    commentCount: 0,
    authorName: 'Author',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    board: { id: 'board_1', name: 'Board', slug: 'board' },
    tags: [],
  } as unknown as PostListItem
}

const POSTS = [post('post_a', 'Alpha'), post('post_b', 'Beta')]

function view(duplicateCountByPostId: Map<PostId, number> | undefined) {
  return (
    <FeedbackTableView
      posts={POSTS}
      statuses={[]}
      boards={[]}
      tags={[]}
      members={[]}
      filters={{ sort: 'newest', hasDuplicates: true }}
      onFiltersChange={() => {}}
      hasMore={false}
      isLoading={false}
      isLoadingMore={false}
      onNavigateToPost={() => {}}
      onLoadMore={() => {}}
      hasActiveFilters
      onClearFilters={() => {}}
      onToggleStatus={() => {}}
      onToggleBoard={() => {}}
      duplicateCountByPostId={duplicateCountByPostId}
    />
  )
}

afterEach(cleanup)

describe('Has duplicates filter', () => {
  it('lists only the posts with a pending suggestion', () => {
    render(view(new Map([['post_b' as PostId, 1]])))
    expect(screen.getAllByTestId('row').map((r) => r.textContent)).toEqual(['Beta'])
  })

  it('lists nothing when no loaded post has a suggestion', () => {
    render(view(new Map()))
    expect(screen.queryAllByTestId('row')).toEqual([])
    expect(screen.getByText('empty: no-results')).toBeInTheDocument()
  })

  it('lists nothing while the counts are still loading', () => {
    render(view(undefined))
    expect(screen.queryAllByTestId('row')).toEqual([])
  })
})

describe('mergeDuplicateCounts', () => {
  it('is undefined while a page is loading, and an empty map once none has a suggestion', () => {
    expect(mergeDuplicateCounts([{ status: 'pending' }])).toBeUndefined()
    expect(mergeDuplicateCounts([{ status: 'success', data: [] }])).toEqual(new Map())
    expect(
      mergeDuplicateCounts([
        { status: 'success', data: [{ postId: 'post_a' as PostId, count: 2 }] },
        { status: 'error' },
      ])
    ).toEqual(new Map([['post_a', 2]]))
  })
})
