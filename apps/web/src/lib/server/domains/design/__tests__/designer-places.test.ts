/**
 * The page switcher's places: read as a signed-out visitor, given their own
 * portal addresses, help topics at the top level only, and a list that
 * cannot be read left empty rather than failing the rest.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  boards: vi.fn(),
  roadmaps: vi.fn(),
  categories: vi.fn(),
  articles: vi.fn(),
  changelogs: vi.fn(),
  posts: vi.fn(),
  actors: [] as unknown[],
}))

vi.mock('@/lib/server/policy', () => ({ ANONYMOUS_ACTOR: { kind: 'anonymous' } }))
vi.mock('@/lib/server/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('@/lib/server/domains/boards/board.public', () => ({
  listPublicBoardsWithStats: hoisted.boards,
}))
vi.mock('@/lib/server/domains/roadmaps/roadmap.service', () => ({
  listPublicRoadmaps: hoisted.roadmaps,
}))
vi.mock('@/lib/server/domains/help-center/help-center.category.service', () => ({
  listPublicCategories: hoisted.categories,
}))
vi.mock('@/lib/server/domains/help-center/help-center.article.query', () => ({
  listPublicArticlesForCategories: hoisted.articles,
}))
vi.mock('@/lib/server/domains/changelog/changelog.public', () => ({
  listPublicChangelogs: hoisted.changelogs,
}))
vi.mock('@/lib/server/domains/statuses/status.service', () => ({
  listPublicStatuses: async () => [
    { id: 'status_planned', name: 'Planned' },
    { id: 'status_complete', name: 'Complete' },
  ],
}))
vi.mock('../designer-posts', () => ({ DESIGNER_POST_LIMIT: 12, listDesignerPosts: hoisted.posts }))

const { listDesignerPlaces } = await import('../designer-places')

beforeEach(() => {
  hoisted.boards.mockResolvedValue([{ id: 'b1', name: 'Bugs', slug: 'bugs', extra: 1 }])
  hoisted.roadmaps.mockResolvedValue([
    {
      id: 'r1',
      name: 'Product',
      columns: [
        { name: 'Planned', statusId: 's1' },
        { name: 'Ideas', statusId: null },
      ],
    },
    {
      id: 'r2',
      name: 'Later',
      columns: [
        { name: 'Planned again', statusId: 's1' },
        { name: 'Done', statusId: 's2' },
      ],
    },
  ])
  hoisted.categories.mockResolvedValue([
    { id: 'c2', parentId: null, name: 'Second', slug: 'second', urlId: 2, position: 2 },
    { id: 'c1', parentId: null, name: 'First', slug: 'first', urlId: 1, position: 1 },
    { id: 'c3', parentId: 'c1', name: 'Nested', slug: 'nested', urlId: 3, position: 0 },
  ])
  hoisted.articles.mockResolvedValue(
    new Map([
      ['c1', [{ id: 'a1', title: 'Start', urlId: 7, slug: 'start' }]],
      ['c2', [{ id: 'a2', title: 'Then', urlId: 8, slug: 'then' }]],
    ])
  )
  hoisted.changelogs.mockResolvedValue({ items: [{ id: 'changelog_1', title: 'Shipped' }] })
  hoisted.posts.mockResolvedValue([{ id: 'p1', title: 'Idea', path: '/b/bugs/posts/p1' }])
})

describe('listDesignerPlaces', () => {
  it('lists each place with its portal address, as a signed-out visitor sees it', async () => {
    expect(await listDesignerPlaces()).toEqual({
      boards: [{ id: 'b1', name: 'Bugs', slug: 'bugs' }],
      roadmaps: [
        { id: 'r1', name: 'Product' },
        { id: 'r2', name: 'Later' },
      ],
      // Each column by its status once, so Quackback AI can pick one by name.
      columns: [
        { id: 's1', name: 'Planned' },
        { id: 's2', name: 'Done' },
      ],
      // The posts' statuses, so Quackback AI can pick the shipped ones by name.
      statuses: [
        { id: 'status_planned', name: 'Planned' },
        { id: 'status_complete', name: 'Complete' },
      ],
      categories: [
        { id: 'c1', name: 'First', path: '/hc/en/collections/1-first' },
        { id: 'c2', name: 'Second', path: '/hc/en/collections/2-second' },
      ],
      posts: [{ id: 'p1', title: 'Idea', path: '/b/bugs/posts/p1' }],
      entries: [{ id: 'changelog_1', title: 'Shipped', path: '/changelog/changelog_1' }],
      articles: [
        { id: 'a1', title: 'Start', path: '/hc/en/articles/7-start' },
        { id: 'a2', title: 'Then', path: '/hc/en/articles/8-then' },
      ],
    })
    for (const read of [hoisted.boards, hoisted.roadmaps, hoisted.categories])
      expect(read).toHaveBeenCalledWith({ kind: 'anonymous' })
    expect(hoisted.changelogs).toHaveBeenCalledWith({ limit: 12 }, { kind: 'anonymous' })
    expect(hoisted.articles).toHaveBeenCalledWith(['c1', 'c2'], { kind: 'anonymous' })
  })

  it('leaves a list empty when it cannot be read, and keeps the rest', async () => {
    hoisted.roadmaps.mockRejectedValue(new Error('down'))
    hoisted.articles.mockRejectedValue(new Error('down'))
    const places = await listDesignerPlaces()
    expect(places.roadmaps).toEqual([])
    expect(places.articles).toEqual([])
    expect(places.boards).toHaveLength(1)
  })
})
