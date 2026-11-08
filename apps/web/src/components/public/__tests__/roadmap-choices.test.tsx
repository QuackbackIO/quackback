// @vitest-environment happy-dom
/**
 * The roadmap as the design chooses it: a column per status or one list
 * grouped by status, and its cards with the vote box or without. Without a
 * choice the board, its columns and its cards are exactly what they were.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params: _params,
    children,
    ...rest
  }: {
    to: string
    params?: unknown
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...(rest as React.HTMLAttributes<HTMLAnchorElement>)}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/public/portal-vote', () => ({
  PortalVote: ({ post }: { post: { voteCount: number } }) => (
    <button type="button" data-qb-part="vote-button">
      {post.voteCount}
    </button>
  ),
}))

const POSTS = [
  {
    id: 'post_1',
    title: 'Exports',
    voteCount: 9,
    commentCount: 2,
    eta: null,
    board: { id: 'board_1', slug: 'ideas', name: 'Ideas' },
  },
  {
    id: 'post_2',
    title: 'Dark mode',
    voteCount: 4,
    commentCount: 0,
    eta: null,
    board: { id: 'board_1', slug: 'ideas', name: 'Ideas' },
  },
]

vi.mock('@/lib/client/hooks/use-roadmap-posts-query', () => ({
  usePublicRoadmapPosts: () => ({
    data: { pages: [{ items: POSTS, total: 2 }] },
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isLoading: false,
  }),
  flattenRoadmapViewPosts: (data: { pages: Array<{ items: unknown[] }> }) =>
    data.pages.flatMap((page) => page.items),
}))

const ROADMAP = {
  id: 'roadmap_1',
  name: 'Product',
  description: null,
  type: 'status',
  columns: [
    { id: 'col_1', statusId: 'status_1', name: 'Planned', icon: null, color: '#6366f1' },
    { id: 'col_2', statusId: 'status_2', name: 'In progress', icon: null, color: '#f59e0b' },
  ],
}

vi.mock('@/lib/client/hooks/use-roadmaps-query', () => ({
  usePublicRoadmaps: () => ({ data: undefined }),
  useRoadmapDateBuckets: () => ({ data: [] }),
}))
vi.mock('@/lib/client/hooks/use-segments-queries', () => ({ useSegments: () => ({ data: [] }) }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useSuspenseQuery: () => ({ data: [] }),
}))
vi.mock('../use-public-roadmap-selection', () => ({
  usePublicRoadmapSelection: () => ({
    selectedRoadmapId: 'roadmap_1',
    setSelectedRoadmap: vi.fn(),
  }),
}))
vi.mock('../use-public-roadmap-filters', () => ({
  usePublicRoadmapFilters: () => ({
    filters: {},
    setFilters: vi.fn(),
    clearFilters: vi.fn(),
    toggleBoard: vi.fn(),
    toggleTag: vi.fn(),
    toggleSegment: vi.fn(),
  }),
}))
vi.mock('../public-roadmap-toolbar', () => ({ PublicRoadmapToolbar: () => <div>toolbar</div> }))
vi.mock('../public-roadmap-filters-bar', () => ({
  PublicRoadmapFiltersBar: () => null,
  PublicRoadmapToolbarFilterButton: () => null,
}))

import { RoadmapBoard } from '../roadmap-board'
import { RoadmapCard } from '../roadmap-card'

afterEach(cleanup)

function board(props: Partial<Parameters<typeof RoadmapBoard>[0]> = {}) {
  return render(
    <IntlProvider locale="en" onError={() => {}}>
      <RoadmapBoard
        initialRoadmaps={[ROADMAP] as never}
        initialSelectedRoadmapId="roadmap_1"
        {...props}
      />
    </IntlProvider>
  ).container
}

/**
 * The markup with the designer's section markers left out, which only make a
 * part pickable, and React's generated ids, which count up across renders.
 */
const today = (node: Element) =>
  node.innerHTML.replace(/ data-qb-section="[^"]*"/g, '').replace(/_r_[0-9a-z]+_/g, '_r_')

describe('the roadmap without a choice', () => {
  it('is exactly today’s board', () => {
    expect(today(board())).toMatchSnapshot()
  })

  it('is the same as choosing columns with votes', () => {
    expect(today(board({ layout: 'columns', votes: true }))).toBe(today(board()))
  })

  it('is one section the designer can pick', () => {
    expect(board().querySelectorAll('[data-qb-section="board"]')).toHaveLength(1)
  })

  it('draws a card as it was', () => {
    const card = render(
      <RoadmapCard
        id="post_1"
        title="Exports"
        voteCount={9}
        commentCount={2}
        board={{ id: 'board_1', slug: 'ideas', name: 'Ideas' }}
        voting
      />
    ).container
    expect(card.innerHTML).toMatchSnapshot()
  })
})

describe('the roadmap’s choices', () => {
  it('as a list: each status a group down the page, not columns across it', () => {
    const page = board({ layout: 'list' })
    expect(page.querySelector('.overflow-x-auto')).toBeNull()
    const groups = page.querySelectorAll('section[aria-labelledby]')
    expect(groups).toHaveLength(2)
    expect(groups[0]!.querySelector('h2')!.textContent).toContain('Planned')
    expect(groups[1]!.querySelector('h2')!.textContent).toContain('In progress')
    expect(groups[0]!.querySelectorAll('[data-qb-surface="card"]')).toHaveLength(2)
    // Each is a post card, which Post cards style apart from panels.
    expect(groups[0]!.querySelectorAll('[data-qb-surface="card"][data-qb-post]')).toHaveLength(2)
  })

  it('leaves the vote box off the cards, keeping the count out of them too', () => {
    for (const layout of ['columns', 'list'] as const) {
      const page = board({ layout, votes: false })
      expect(page.querySelector('[data-qb-part="vote-button"]'), layout).toBeNull()
      expect(page.querySelector('.roadmap-card__vote'), layout).toBeNull()
      expect(page.textContent, layout).toContain('Exports')
      cleanup()
    }
  })

  it('keeps the vote box with votes on', () => {
    expect(board({ layout: 'list' }).querySelectorAll('[data-qb-part="vote-button"]')).toHaveLength(
      4
    )
  })
})
