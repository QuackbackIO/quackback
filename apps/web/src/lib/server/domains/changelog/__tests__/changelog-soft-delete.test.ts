import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChangelogId } from '@quackback/ids'

const mockEntryFindFirst = vi.fn()
const mockEntryFindMany = vi.fn()
const mockLinkedPostsFindMany = vi.fn()
const mockStatusesFindMany = vi.fn()

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
      changelogEntryPosts: {
        findMany: (...args: unknown[]) => mockLinkedPostsFindMany(...args),
      },
      postStatuses: {
        findMany: (...args: unknown[]) => mockStatusesFindMany(...args),
      },
    },
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        return {
          where: (...args: unknown[]) => {
            mockUpdateWhere(...args)
            return { returning: () => mockUpdateReturning() }
          },
        }
      },
    }),
  },
  changelogEntries: changelogEntriesTable,
  changelogEntryPosts: { changelogEntryId: 'changelog_entry_id' },
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
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockLinkedPostsFindMany.mockResolvedValue([])
  mockStatusesFindMany.mockResolvedValue([])
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

    mockEntryFindMany.mockResolvedValueOnce([])

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
    })
    mockEntryFindMany.mockResolvedValueOnce([])

    await listPublicChangelogs({ cursor: 'cl_cursor' })

    // The cursor lookup itself does NOT filter on deletedAt — it must
    // find the row even if deleted, so we keep paginating past it.
    const cursorEqCalls = vi
      .mocked(eq)
      .mock.calls.filter(
        (args) => (args[0] as unknown) === changelogEntriesTable.id && args[1] === 'cl_cursor'
      )
    expect(cursorEqCalls.length).toBe(1)

    // The pagination filter (lt publishedAt) was applied, so the user
    // doesn't fall back to the first page.
    const ltPublishedAtCalls = vi
      .mocked(lt)
      .mock.calls.filter((args) => (args[0] as unknown) === changelogEntriesTable.publishedAt)
    expect(ltPublishedAtCalls.length).toBeGreaterThanOrEqual(1)
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
