// @vitest-environment happy-dom
/**
 * Home's blocks of the workspace's data, as their settings say: what each
 * item shows, which columns and topics, their own words, and what each does
 * with nothing to show. The live portal never shows made-up items; the
 * builder draws samples, marked as such.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

vi.mock('@/lib/client/hooks/use-post-vote', () => ({
  usePostVote: ({ voteCount }: { voteCount: number }) => ({
    voteCount,
    hasVoted: false,
    isPending: false,
    handleVote: vi.fn(),
  }),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopover: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => async () => true,
}))

import { HomeBlockView, type HomeBlock } from '../home-blocks'
import { PreviewSamplesContext } from '@/components/public/preview-draft-context'
import { portalQueries } from '@/lib/client/queries/portal'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { publicStatusPageQueries } from '@/lib/client/queries/status'
import { roadmapPostsKeys } from '@/lib/client/hooks/use-roadmap-posts-query'
import { popularArticlesQuery } from '../home-prefetch'
import { Skeleton } from '@/components/ui/skeleton'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const GRID = { x: 0, y: 0, w: 12, h: 1 }

const POSTS = [
  {
    id: 'post_a',
    title: 'Dark mode',
    voteCount: 4,
    commentCount: 6,
    statusId: 'status_planned',
    board: { id: 'b_open', slug: 'open', name: 'Open' },
  },
]

interface World {
  posts?: typeof POSTS
  entries?: Array<{ id: string; title: string; publishedAt: string; content: string }>
  components?: number
  categories?: Array<{ id: string; parentId: string | null; name: string }>
  boards?: Array<{ id: string; slug: string; name: string; postCount: number }>
  /** The roadmap columns' posts: still loading, none, or four each (the default). */
  roadmapPosts?: 'loading' | 'none'
}

function client(world: World, block: HomeBlock): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  if (block.type === 'ideas')
    qc.setQueryData(portalQueries.homeIdeas(block).queryKey, {
      items: world.posts ?? [],
      hasMore: false,
    } as never)
  qc.setQueryData(portalQueries.statuses().queryKey, [
    { id: 'status_planned', name: 'Planned', color: '#3b82f6', category: 'active' },
    { id: 'status_shipped', name: 'Shipped', color: '#16a34a', category: 'complete' },
  ] as never)
  qc.setQueryData(portalQueries.boards().queryKey, (world.boards ?? []) as never)
  qc.setQueryData(portalQueries.boardCapabilities().queryKey, {
    permissions: {},
    boards: [],
  } as never)
  qc.setQueryData(publicChangelogQueries.list().queryKey, {
    pages: [{ items: world.entries ?? [], nextCursor: null, hasMore: false }],
    pageParams: [undefined],
  } as never)
  const component = { id: 'c', name: 'API', description: null, status: 'operational' }
  qc.setQueryData(publicStatusPageQueries.get().queryKey, {
    snapshot: {
      topLevel: {
        status: 'operational',
        worstComponentStatus: 'operational',
        activeIncidentCount: 1,
      },
      groups: [],
      ungroupedComponents: Array.from({ length: world.components ?? 0 }, () => component),
      activeIncidents: [{ id: 'incident_1', title: 'Slow emails' }],
      upcomingMaintenance: [],
      recentIncidents: [],
    },
  } as never)
  qc.setQueryData(
    publicHelpCenterQueries.categories().queryKey,
    (world.categories ?? []).map((category, at) => ({
      ...category,
      urlId: at + 1,
      slug: category.id,
      icon: null,
      description: null,
      articleCount: 3,
    })) as never
  )
  qc.setQueryData(popularArticlesQuery().queryKey, [
    { id: 'a1', urlId: 1, slug: 'one', title: 'First article', categoryName: 'Start' },
    { id: 'a2', urlId: 2, slug: 'two', title: 'Second article', categoryName: 'Start' },
    { id: 'a3', urlId: 3, slug: 'three', title: 'Third article', categoryName: 'Start' },
    { id: 'a4', urlId: 4, slug: 'four', title: 'Fourth article', categoryName: 'Start' },
  ] as never)
  qc.setQueryData(portalQueries.roadmaps().queryKey, [
    {
      id: 'roadmap_1',
      name: 'Our roadmap',
      columns: [
        { id: 'col_a', name: 'Planned', color: null, statusId: 'status_planned' },
        { id: 'col_b', name: 'Shipped', color: null, statusId: 'status_shipped' },
      ],
    },
  ] as never)
  for (const statusId of world.roadmapPosts === 'loading'
    ? []
    : ['status_planned', 'status_shipped'])
    qc.setQueryData(roadmapPostsKeys.portal('roadmap_1' as never, statusId as never), {
      pages: [
        {
          items: (world.roadmapPosts === 'none' ? [] : [1, 2, 3, 4]).map((n) => ({
            id: `${statusId}_${n}`,
            title: `${statusId} post ${n}`,
            voteCount: n * 10,
            board: { slug: 'open' },
          })),
          hasMore: false,
        },
      ],
      pageParams: [0],
    } as never)
  return qc
}

function show(block: HomeBlock, world: World = {}, { samples = false } = {}) {
  const root = createRootRoute()
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <PreviewSamplesContext.Provider value={samples}>
        <div data-route-drawn="" />
        <HomeBlockView block={block} index={0} gates={GATES} />
      </PreviewSamplesContext.Provider>
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const { container } = render(
    <QueryClientProvider client={client(world, block)}>
      <IntlProvider locale="en" onError={() => {}}>
        <RouterProvider router={router} />
      </IntlProvider>
    </QueryClientProvider>
  )
  return container
}

/** Waits for the router to draw, then for the block, or for nothing in its place. */
async function drawn(container: HTMLElement) {
  // The route has drawn, and the block is no longer waiting on its data.
  await waitFor(() => expect(container.querySelector('[data-route-drawn]')).not.toBeNull())
  await waitFor(() => expect(container.querySelector('[data-qb-skeleton]')).toBeNull())
  await new Promise((resolve) => setTimeout(resolve, 0))
  return container.querySelector('[data-qb-block]')
}

const block = (fields: Record<string, unknown>) =>
  ({ id: 'blockid001', grid: GRID, ...fields }) as HomeBlock

afterEach(cleanup)

describe('Status', () => {
  const status = (more: Record<string, unknown> = {}) => block({ type: 'status', ...more })

  it('never says all is well on a status page with no components: it hides', async () => {
    const container = show(status(), { components: 0 })
    expect(await drawn(container)).toBeNull()
    expect(screen.queryByText('All systems operational')).toBeNull()
  })

  it('says its message instead when told to, in its own words or its usual ones', async () => {
    show(status({ whenEmpty: 'message' }), { components: 0 })
    expect(await screen.findByText('No status to show yet.')).toBeTruthy()
    cleanup()
    show(status({ whenEmpty: 'message', emptyText: { en: 'Status coming soon' } }), {
      components: 0,
    })
    const words = await screen.findByText('Status coming soon')
    expect(words.getAttribute('data-qb-words')).toBe('block-blockid001.empty')
    expect(screen.queryByText('All systems operational')).toBeNull()
  })

  it('draws a sample in the builder alone, and says it is one', async () => {
    show(status(), { components: 0 }, { samples: true })
    expect(await screen.findByText('Sample')).toBeTruthy()
    expect(screen.getByText('All systems operational')).toBeTruthy()
    expect(screen.queryByText('Slow emails')).toBeNull()
  })

  it('shows the status with its incidents, or without them when told', async () => {
    show(status(), { components: 2 })
    expect(await screen.findByText('All systems operational')).toBeTruthy()
    expect(screen.getByText('Slow emails')).toBeTruthy()
    expect(screen.queryByText('Sample')).toBeNull()
    cleanup()
    show(status({ showIncidents: false }), { components: 2 })
    await screen.findByText('All systems operational')
    expect(screen.queryByText('Slow emails')).toBeNull()
  })
})

describe('Top posts', () => {
  const ideas = (more: Record<string, unknown> = {}) =>
    block({ type: 'ideas', sort: 'top', count: 5, ...more })

  it('shows votes and status, and comments only when told', async () => {
    const container = show(ideas(), { posts: POSTS })
    await screen.findByText('Dark mode')
    expect(container.querySelector('[data-qb-part=vote-button]')).not.toBeNull()
    expect(screen.getByText('Planned')).toBeTruthy()
    expect(screen.queryByText('6 comments')).toBeNull()
    cleanup()
    const plain = show(ideas({ showVotes: false, showStatus: false, showComments: true }), {
      posts: POSTS,
    })
    await screen.findByText('Dark mode')
    expect(plain.querySelector('[data-qb-part=vote-button]')).toBeNull()
    expect(screen.queryByText('Planned')).toBeNull()
    expect(screen.getByText('6 comments')).toBeTruthy()
  })

  it('says its message with no posts, and hides when told to', async () => {
    show(ideas(), { posts: [] })
    expect(await screen.findByText('No posts yet. Be the first.')).toBeTruthy()
    cleanup()
    const container = show(ideas({ whenEmpty: 'hide' }), { posts: [] })
    expect(await drawn(container)).toBeNull()
  })

  it('draws made-up posts only in the builder, marked as samples', async () => {
    const container = show(ideas({ whenEmpty: 'hide' }), { posts: [] }, { samples: true })
    expect(await screen.findByText('Sample')).toBeTruthy()
    expect(screen.getByText('Dark mode for the dashboard')).toBeTruthy()
    // Samples lead nowhere.
    expect(container.querySelector('a[href*="/posts/"]')).toBeNull()
  })

  it('names its way on in its own words, marked to edit in place', async () => {
    show(ideas({ link: { en: 'Every idea' } }), { posts: POSTS })
    const link = await screen.findByText('Every idea')
    expect(link.getAttribute('data-qb-words')).toBe('block-blockid001.link')
    expect(screen.queryByText('See all posts')).toBeNull()
  })
})

describe('Top posts from chosen statuses', () => {
  it('is headed Recently shipped while it shows only shipped statuses', async () => {
    show(block({ type: 'ideas', sort: 'new', count: 5, statusIds: ['status_shipped'] }), {
      posts: POSTS,
    })
    expect(await screen.findByText('Recently shipped')).toBeTruthy()
    cleanup()
    show(block({ type: 'ideas', sort: 'new', count: 5, statusIds: ['status_planned'] }), {
      posts: POSTS,
    })
    expect(await screen.findByText('Newest posts')).toBeTruthy()
  })
})

describe('Boards', () => {
  const BOARDS = [
    { id: 'board_a', slug: 'ideas', name: 'Ideas', postCount: 12 },
    { id: 'board_b', slug: 'bugs', name: 'Bugs', postCount: 1 },
  ]

  it('lists the portal’s boards with their posts, each leading to its board', async () => {
    show(block({ type: 'boards' }), { boards: BOARDS })
    const ideas = await screen.findByText('Ideas')
    expect(ideas.closest('a')?.getAttribute('href')).toBe('/feedback?board=ideas')
    expect(screen.getByText('12 posts')).toBeTruthy()
    expect(screen.getByText('1 post')).toBeTruthy()
    expect(screen.getByText('Boards')).toBeTruthy()
  })

  it('leaves the counts off when told', async () => {
    show(block({ type: 'boards', showCounts: false }), { boards: BOARDS })
    await screen.findByText('Ideas')
    expect(screen.queryByText('12 posts')).toBeNull()
  })

  it('draws nothing without boards', async () => {
    const container = show(block({ type: 'boards' }), { boards: [] })
    expect(await drawn(container)).toBeNull()
  })
})

describe('Latest updates', () => {
  const ENTRIES = [
    {
      id: 'entry_1',
      title: 'Faster search',
      publishedAt: '2026-10-01T00:00:00.000Z',
      content: 'Search finds things **faster** now.',
    },
  ]
  const updates = (more: Record<string, unknown> = {}) =>
    block({ type: 'updates', count: 3, ...more })

  it('shows the date, and the summary only when told', async () => {
    const container = show(updates(), { entries: ENTRIES })
    await screen.findByText('Faster search')
    expect(container.querySelector('time')).not.toBeNull()
    expect(screen.queryByText(/Search finds things/)).toBeNull()
    cleanup()
    const other = show(updates({ showDate: false, showSummary: true }), { entries: ENTRIES })
    await screen.findByText('Faster search')
    expect(other.querySelector('time')).toBeNull()
    expect(screen.getByText('Search finds things faster now.')).toBeTruthy()
  })

  it('hides with no entries, as it always did, or says its message', async () => {
    const container = show(updates(), { entries: [] })
    expect(await drawn(container)).toBeNull()
    cleanup()
    show(updates({ whenEmpty: 'message' }), { entries: [] })
    expect(await screen.findByText('No updates yet.')).toBeTruthy()
  })
})

describe('Help topics', () => {
  const CATEGORIES = [
    { id: 'kb_category_a', parentId: null, name: 'Alpha' },
    { id: 'kb_category_sub', parentId: 'kb_category_a', name: 'Sub' },
    { id: 'kb_category_b', parentId: null, name: 'Beta' },
  ]
  const topics = (more: Record<string, unknown> = {}) =>
    block({ type: 'help_topics', categoryIds: [], ...more })

  it('draws the picked topics in the order picked', async () => {
    const container = show(topics({ categoryIds: ['kb_category_b', 'kb_category_a'] }), {
      categories: CATEGORIES,
    })
    await screen.findByText('Beta')
    const names = [...container.querySelectorAll('h3')].map((h) => h.textContent)
    expect(names).toEqual(['Beta', 'Alpha'])
  })

  it('leaves out a block whose picked topics are all sub-topics, rather than say there are none', async () => {
    const container = show(topics({ categoryIds: ['kb_category_sub'] }), {
      categories: CATEGORIES,
    })
    expect(await drawn(container)).toBeNull()
    expect(screen.queryByText('No categories yet. Check back soon.')).toBeNull()
  })

  it('shows article counts unless told not to', async () => {
    show(topics(), { categories: CATEGORIES })
    expect((await screen.findAllByText('3 articles')).length).toBe(2)
    cleanup()
    show(topics({ showCounts: false }), { categories: CATEGORIES })
    await screen.findByText('Alpha')
    expect(screen.queryByText('3 articles')).toBeNull()
  })
})

describe('Help topics, in a narrow block', () => {
  const topics = block({ type: 'help_topics', categoryIds: [] })

  it('measures its own width, so its cards wrap to fewer columns when the block is narrow', async () => {
    const container = show(topics, {
      categories: [{ id: 'kb_category_a', parentId: null, name: 'Alpha' }],
    })
    await screen.findByText('Alpha')
    const grid = container.querySelector('[data-qb-topics]')
    expect(grid?.parentElement?.className).toContain('@container')
    // As narrow as a third of the page, one column; as a half, two; wider, as the screen gives.
    expect(grid?.className).toContain('@max-[30rem]:grid-cols-1!')
    expect(grid?.className).toContain('@min-[30rem]:@max-[40rem]:lg:grid-cols-2!')
  })
})

describe('Welcome', () => {
  const empty = block({ type: 'welcome', body: { type: 'doc', content: [{ type: 'paragraph' }] } })

  it('draws a place to write it in the builder, marked to edit in place', async () => {
    const container = show(empty, {}, { samples: true })
    expect(await drawn(container)).not.toBeNull()
    const words = container.querySelector('[data-qb-words="block-blockid001.body"]')
    expect(words).not.toBeNull()
    expect(words?.textContent).toBe('')
    expect(words?.getAttribute('data-qb-words-placeholder')).toBe('Write a welcome')
  })

  it('draws nothing for visitors while it has no words', async () => {
    const container = show(empty)
    expect(await drawn(container)).toBeNull()
  })
})

describe('Help search', () => {
  it('lists five popular articles, fewer or none as it says', async () => {
    show(block({ type: 'help_search' }))
    await screen.findByText('First article')
    expect(screen.getByText('Fourth article')).toBeTruthy()
    cleanup()
    show(block({ type: 'help_search', popular: 3 }))
    await screen.findByText('Third article')
    expect(screen.queryByText('Fourth article')).toBeNull()
    cleanup()
    const container = show(block({ type: 'help_search', popular: 0 }))
    await drawn(container)
    expect(screen.queryByText('First article')).toBeNull()
  })
})

describe('Roadmap', () => {
  const roadmap = (more: Record<string, unknown> = {}) =>
    block({ type: 'roadmap', roadmapId: null, ...more })

  it('shows two posts per column, as it always did, or as many as it says', async () => {
    show(roadmap())
    await screen.findByText('status_planned post 2')
    expect(screen.queryByText('status_planned post 3')).toBeNull()
    cleanup()
    show(roadmap({ perColumn: 3, showVotes: true }))
    await screen.findByText('status_planned post 3')
    expect(screen.getAllByText('30 votes')).toHaveLength(2)
  })

  it('shows only the picked columns', async () => {
    show(roadmap({ statusIds: ['status_shipped'] }))
    await screen.findByText('Shipped')
    expect(screen.queryByText('Planned')).toBeNull()
  })

  it('holds a row for each post while a column loads, and never calls it empty before it knows', async () => {
    const container = show(roadmap({ perColumn: 3 }), { roadmapPosts: 'loading' })
    await screen.findByText('Planned')
    const holders = container.querySelectorAll('[data-qb-skeleton=roadmap-posts]')
    expect(holders).toHaveLength(2)
    for (const holder of holders) {
      expect(holder.getAttribute('aria-hidden')).toBe('true')
      expect(holder.querySelectorAll('li')).toHaveLength(3)
    }
    expect(screen.queryByText('Nothing here yet')).toBeNull()
    // The app's one placeholder look.
    const { container: reference } = render(<Skeleton />)
    const look = reference.querySelector('[data-slot=skeleton]')!.className.split(' ')
    expect(holders[0]!.querySelector('li')!.className.split(' ')).toEqual(
      expect.arrayContaining(look)
    )
  })

  it('says a column is empty once its posts are known to be none', async () => {
    show(roadmap(), { roadmapPosts: 'none' })
    expect(await screen.findAllByText('Nothing here yet')).toHaveLength(2)
  })
})

describe('Contact', () => {
  it('says its line and its button in its own words, each marked to edit in place', async () => {
    show(block({ type: 'contact', text: { en: 'Write to us' }, link: { en: 'Write' } }))
    const line = await screen.findByText('Write to us')
    expect(line.getAttribute('data-qb-words')).toBe('block-blockid001.text')
    expect(screen.getByText('Write').getAttribute('data-qb-words')).toBe('block-blockid001.link')
  })
})

describe('a block on a tablet', () => {
  it('keeps to its own height at the top of its area, never stretched to its row-mate’s', async () => {
    show(block({ type: 'status' }), { components: 2 })
    await screen.findByText('All systems operational')
    const section = document.querySelector('[data-qb-block]') as HTMLElement
    expect(section.className.split(/\s+/)).toContain('md:max-lg:self-start')
  })
})

describe('a block left off phones', () => {
  const links = (look?: Record<string, unknown>) =>
    block({ type: 'links', links: [{ label: 'Docs', url: 'https://docs.example' }], look })

  it('is gone below the phone breakpoint for visitors, and drawn on wider screens', async () => {
    const drawnBlock = await drawn(show(links({ phone: { hidden: true } })))
    expect(drawnBlock?.className.split(' ')).toContain('max-md:hidden')
    expect(drawnBlock?.className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(drawnBlock?.hasAttribute('data-qb-phone-hidden')).toBe(true)
  })

  it('stays in the builder, faded on phones, to be picked', async () => {
    const drawnBlock = await drawn(show(links({ phone: { hidden: true } }), {}, { samples: true }))
    expect(drawnBlock?.className).not.toContain('max-md:hidden')
    expect(drawnBlock?.className.split(' ')).toContain('max-md:opacity-50')
  })

  it('is not set apart while phones show it', async () => {
    const drawnBlock = await drawn(show(links()))
    expect(drawnBlock?.className).not.toContain('max-md:')
    expect(drawnBlock?.hasAttribute('data-qb-phone-hidden')).toBe(false)
  })
})
