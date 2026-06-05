/**
 * Public changelog views are recorded. getPublicChangelogById increments the
 * entry's view_count (fire-and-forget) whenever a published entry is fetched —
 * the same pattern help-center articles use. A miss (not found / not published)
 * must NOT increment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChangelogId } from '@quackback/ids'

const mockFindFirst = vi.fn()
const mockSelect = vi.fn()
const mockUpdate = vi.fn()
const mockSet = vi.fn()
const mockWhere = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      changelogEntries: { findFirst: (...a: unknown[]) => mockFindFirst(...a) },
      postStatuses: { findMany: vi.fn().mockResolvedValue([]) },
    },
    select: (...a: unknown[]) => mockSelect(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
  changelogEntries: {
    id: 'id',
    publishedAt: 'published_at',
    deletedAt: 'deleted_at',
    viewCount: 'view_count',
  },
  changelogEntryPosts: { changelogEntryId: 'changelog_entry_id', postId: 'post_id' },
  posts: {
    id: 'posts.id',
    title: 'posts.title',
    voteCount: 'posts.voteCount',
    boardId: 'posts.boardId',
    statusId: 'posts.statusId',
    deletedAt: 'posts.deletedAt',
    moderationState: 'posts.moderationState',
  },
  boards: {
    id: 'boards.id',
    slug: 'boards.slug',
    access: 'boards.access',
    deletedAt: 'boards.deletedAt',
  },
  postStatuses: { id: 'id' },
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  or: vi.fn((...args: unknown[]) => ({ kind: 'or', args })),
  isNull: vi.fn((col) => ({ kind: 'isNull', col })),
  isNotNull: vi.fn((col) => ({ kind: 'isNotNull', col })),
  lt: vi.fn((col, val) => ({ kind: 'lt', col, val })),
  lte: vi.fn((col, val) => ({ kind: 'lte', col, val })),
  desc: vi.fn((col) => ({ kind: 'desc', col })),
  inArray: vi.fn((col, vals) => ({ kind: 'inArray', col, vals })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ kind: 'sql', strings: Array.from(strings) })),
    { raw: vi.fn() }
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  // db.update(...).set(...).where(...).catch(...)
  mockWhere.mockReturnValue({ catch: vi.fn() })
  mockSet.mockReturnValue({ where: mockWhere })
  mockUpdate.mockReturnValue({ set: mockSet })
  // db.select(...).from(...).innerJoin(...).innerJoin(...).where(...) => []
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.innerJoin = () => chain
  chain.where = () => Promise.resolve([])
  mockSelect.mockReturnValue(chain)
})

describe('getPublicChangelogById — view tracking', () => {
  it('increments view_count for the viewed entry', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'cl_1',
      title: 'Dark mode',
      content: '',
      contentJson: null,
      publishedAt: new Date('2026-01-01'),
    })
    const { getPublicChangelogById } = await import('../changelog.public')

    await getPublicChangelogById('cl_1' as ChangelogId)

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ viewCount: expect.anything() }))
  })

  it('does not increment when the entry is not found', async () => {
    mockFindFirst.mockResolvedValue(undefined)
    const { getPublicChangelogById } = await import('../changelog.public')

    await expect(getPublicChangelogById('cl_missing' as ChangelogId)).rejects.toBeDefined()

    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
