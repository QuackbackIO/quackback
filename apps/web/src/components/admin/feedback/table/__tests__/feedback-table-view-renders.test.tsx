// @vitest-environment happy-dom
/**
 * Typing in the feedback search box re-renders the search box, not the list
 * or the filter bar. Each row renders for its own post: a keystroke, or the
 * URL change the debounced search makes while the old rows are still showing,
 * costs no row renders, and new results render only the rows that changed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import type { PostId } from '@quackback/ids'
import type { PostListItem, PostStatusEntity } from '@/lib/shared/db-types'
import type { InboxFilters } from '@/components/admin/feedback/use-inbox-filters'

// Each row's card, reduced to a render counter that still wires the click.
const cardRenders = new Map<string, number>()
vi.mock('@/components/public/post-card', () => ({
  PostCard: ({ id, title, onClick }: { id: string; title: string; onClick: () => void }) => {
    cardRenders.set(id, (cardRenders.get(id) ?? 0) + 1)
    return (
      <button type="button" data-post-id={id} onClick={onClick}>
        {title}
      </button>
    )
  },
}))

let filterBarRenders = 0
vi.mock('@/components/admin/feedback/active-filters-bar', () => ({
  ActiveFiltersBar: () => {
    filterBarRenders++
    return null
  },
}))

const { FeedbackTableView } = await import('../feedback-table-view')

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

const STATUSES: PostStatusEntity[] = []
const FIRST = [post('post_a', 'Alpha'), post('post_b', 'Beta'), post('post_c', 'Gamma')]

let setPosts: (posts: PostListItem[]) => void = () => {}
const opened: string[] = []
const filterChanges: Partial<InboxFilters>[] = []
const openPost = (id: string) => opened.push(id)

/** Holds the list's filters the way the inbox holds them in the URL. */
function Harness() {
  const [posts, setPostsState] = useState(FIRST)
  const [filters, setFilters] = useState<InboxFilters>({ sort: 'newest' })
  setPosts = setPostsState
  return (
    <FeedbackTableView
      posts={posts}
      statuses={STATUSES}
      boards={[]}
      tags={[]}
      members={[]}
      filters={filters}
      onFiltersChange={(updates) => {
        filterChanges.push(updates)
        setFilters((current) => ({ ...current, ...updates }))
      }}
      hasMore={false}
      isLoading={false}
      isLoadingMore={false}
      onNavigateToPost={openPost}
      onLoadMore={() => {}}
      hasActiveFilters={!!filters.search}
      onClearFilters={() => {}}
      onToggleStatus={() => {}}
      onToggleBoard={() => {}}
    />
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  cardRenders.clear()
  filterBarRenders = 0
  opened.length = 0
  filterChanges.length = 0
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function rendersSoFar() {
  return Object.fromEntries(cardRenders)
}

describe('FeedbackTableView renders', () => {
  it('renders no row while the search is typed', () => {
    render(<Harness />)
    expect(rendersSoFar()).toEqual({ post_a: 1, post_b: 1, post_c: 1 })

    const search = screen.getByPlaceholderText('Search...')
    let typed = ''
    for (const char of 'export') {
      typed += char
      fireEvent.change(search, { target: { value: typed } })
    }

    expect(search).toHaveValue('export')
    expect(rendersSoFar()).toEqual({ post_a: 1, post_b: 1, post_c: 1 })
    expect(filterBarRenders).toBe(1)
  })

  it('renders no row when the debounced search lands with the old rows still showing', () => {
    render(<Harness />)
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'export' } })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(filterChanges).toEqual([{ search: 'export' }])
    expect(screen.getByPlaceholderText('Search...')).toHaveValue('export')
    expect(rendersSoFar()).toEqual({ post_a: 1, post_b: 1, post_c: 1 })
  })

  it('renders only the rows whose post changed when results arrive', () => {
    render(<Harness />)

    act(() => {
      setPosts([FIRST[0]!, post('post_b', 'Beta, renamed'), post('post_d', 'Delta')])
    })

    expect(rendersSoFar()).toEqual({ post_a: 1, post_b: 2, post_c: 1, post_d: 1 })
    expect(screen.getByText('Beta, renamed')).toBeInTheDocument()
    expect(screen.queryByText('Gamma')).not.toBeInTheDocument()
  })

  it('opens the clicked row', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Beta'))
    expect(opened).toEqual(['post_b'])
  })
})
