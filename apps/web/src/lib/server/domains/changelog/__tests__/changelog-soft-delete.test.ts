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

  it('filters the cursor lookup to exclude soft-deleted entries', async () => {
    const { listPublicChangelogs } = await import('../changelog.public')
    const { isNull } = await import('@/lib/server/db')

    mockEntryFindFirst.mockResolvedValueOnce({
      publishedAt: new Date('2026-01-01'),
    })
    mockEntryFindMany.mockResolvedValueOnce([])

    await listPublicChangelogs({ cursor: 'cl_cursor' })

    const deletedAtCalls = vi
      .mocked(isNull)
      .mock.calls.filter((args) => (args[0] as unknown) === changelogEntriesTable.deletedAt)
    expect(deletedAtCalls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('deleteChangelog', () => {
  it('clears publishedAt when soft-deleting (defense-in-depth)', async () => {
    mockUpdateReturning.mockResolvedValueOnce([{ id: 'cl_1' }])

    const { deleteChangelog } = await import('../changelog.service')
    await deleteChangelog('cl_1' as ChangelogId)

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: expect.any(Date), publishedAt: null })
    )
  })
})
