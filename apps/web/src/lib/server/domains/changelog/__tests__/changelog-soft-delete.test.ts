import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChangelogId } from '@quackback/ids'

const mockEntryFindFirst = vi.fn()
const mockEntryFindMany = vi.fn()
const mockStatusesFindMany = vi.fn()
const mockSelect = vi.fn()

const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockUpdateReturning = vi.fn()

const changelogEntriesTable = {
  id: { name: 'id' },
  publishedAt: { name: 'published_at' },
  deletedAt: { name: 'deleted_at' },
}

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      changelogEntries: {
        findFirst: (...args: unknown[]) => mockEntryFindFirst(...args),
        findMany: (...args: unknown[]) => mockEntryFindMany(...args),
      },
      postStatuses: {
        findMany: (...args: unknown[]) => mockStatusesFindMany(...args),
      },
    },
    select: (...args: unknown[]) => mockSelect(...args),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        return {
          where: (...args: unknown[]) => {
            mockUpdateWhere(...args)
            // `.returning()` for soft-delete writes; `.catch()` for the
            // fire-and-forget view-count increment in getPublicChangelogById.
            return { returning: () => mockUpdateReturning(), catch: () => {} }
          },
        }
      },
    }),
  },
  changelogEntries: changelogEntriesTable,
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
    vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => ({
      kind: 'sql',
      strings: Array.from(strings),
    })),
    { raw: vi.fn() }
  ),
}))

// Chainable mock for `db.select().from().innerJoin()...where()` — resolves
// with the rows you provide when `.where()` is awaited.
function selectChainResolving(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.innerJoin = () => chain
  chain.where = () => Promise.resolve(rows)
  return chain
}

// Chainable mock for the entries query: `db.select().from().where().orderBy().limit()`.
// Resolves with the rows you provide when `.limit()` is awaited.
function entriesListChain(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.where = () => chain
  chain.orderBy = () => chain
  chain.limit = () => Promise.resolve(rows)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStatusesFindMany.mockResolvedValue([])
  // Default: any `db.select(...)` returns an empty linked-post set.
  mockSelect.mockImplementation(() => selectChainResolving([]))
})

describe('getPublicChangelogById', () => {
  it('filters out soft-deleted entries (isNull deletedAt)', async () => {
    const { getPublicChangelogById } = await import('../changelog.public')
    const { isNull } = await import('@/lib/server/db')

    mockEntryFindFirst.mockResolvedValueOnce({
      id: 'cl_1' as ChangelogId,
      title: 'Test',
      content: '',
      contentJson: null,
      publishedAt: new Date('2026-01-01'),
    })

    await getPublicChangelogById('cl_1' as ChangelogId)

    expect(isNull).toHaveBeenCalledWith(changelogEntriesTable.deletedAt)
  })
})

describe('listPublicChangelogs', () => {
  it('filters out soft-deleted entries (isNull deletedAt)', async () => {
    const { listPublicChangelogs } = await import('../changelog.public')
    const { isNull } = await import('@/lib/server/db')

    mockSelect.mockReturnValueOnce(entriesListChain([]))

    await listPublicChangelogs({})

    expect(isNull).toHaveBeenCalledWith(changelogEntriesTable.deletedAt)
  })

  it('keeps cursor pagination working when the anchor row was soft-deleted', async () => {
    const { listPublicChangelogs } = await import('../changelog.public')
    const { eq, lt } = await import('@/lib/server/db')

    // Cursor row still has its publishedAt because deleteChangelog
    // preserves it precisely so pagination has an anchor.
    mockEntryFindFirst.mockResolvedValueOnce({
      publishedAt: new Date('2026-01-01'),
      displayDate: null,
    })
    mockSelect.mockReturnValueOnce(entriesListChain([]))

    await listPublicChangelogs({ cursor: 'cl_cursor' })

    // The cursor lookup itself does NOT filter on deletedAt — it must
    // find the row even if deleted, so we keep paginating past it.
    const cursorEqCalls = vi
      .mocked(eq)
      .mock.calls.filter(
        (args) => (args[0] as unknown) === changelogEntriesTable.id && args[1] === 'cl_cursor'
      )
    expect(cursorEqCalls.length).toBe(1)

    // The pagination filter was applied on the effective display date
    // (coalesce(display_date, published_at)), so the user doesn't fall
    // back to the first page.
    const ltEffectiveDateCalls = vi
      .mocked(lt)
      .mock.calls.filter((args) => (args[0] as { kind?: string })?.kind === 'sql')
    expect(ltEffectiveDateCalls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('deleteChangelog', () => {
  it('sets deletedAt but preserves publishedAt so cursors stay valid', async () => {
    mockUpdateReturning.mockResolvedValueOnce([{ id: 'cl_1' }])

    const { deleteChangelog } = await import('../changelog.service')
    await deleteChangelog('cl_1' as ChangelogId)

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>
    expect(setArgs.deletedAt).toBeInstanceOf(Date)
    expect('publishedAt' in setArgs).toBe(false)
  })
})
