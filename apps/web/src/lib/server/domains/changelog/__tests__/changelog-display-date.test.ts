import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChangelogId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'

const mockEntryFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockChangelogEntryPostsFindMany = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      changelogEntries: {
        findFirst: (...args: unknown[]) => mockEntryFindFirst(...args),
      },
      changelogEntryPosts: {
        findMany: (...args: unknown[]) => mockChangelogEntryPostsFindMany(...args),
      },
      changelogEntryCategories: { findMany: vi.fn().mockResolvedValue([]) },
      principal: { findFirst: vi.fn().mockResolvedValue(null) },
      postStatuses: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        return { where: (...args: unknown[]) => mockUpdateWhere(...args) }
      },
    }),
    delete: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
}))

vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: vi.fn(async (json: unknown) => json),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: vi.fn(() => ({ type: 'user' })),
  dispatchChangelogPublished: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn(),
  cancelScheduledDispatch: vi.fn(),
}))

const ENTRY_ID = 'changelog_01test' as ChangelogId
const PUBLISHED_AT = new Date('2025-06-01T12:00:00Z')

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    title: 'Release',
    content: 'Body',
    contentJson: null,
    principalId: null,
    publishedAt: PUBLISHED_AT,
    displayDate: null,
    createdAt: new Date('2025-06-01T10:00:00Z'),
    updatedAt: new Date('2025-06-01T10:00:00Z'),
    deletedAt: null,
    viewCount: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockChangelogEntryPostsFindMany.mockResolvedValue([])
})

describe('displayDate', () => {
  it('persists displayDate without changing publishedAt', async () => {
    const { updateChangelog } = await import('../changelog.service')
    const pastDisplay = new Date('2024-01-15T09:00:00Z')

    mockEntryFindFirst
      .mockResolvedValueOnce(baseEntry())
      .mockResolvedValueOnce(baseEntry({ displayDate: pastDisplay }))

    await updateChangelog(ENTRY_ID, { displayDate: pastDisplay })

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ displayDate: pastDisplay })
    )
    const updatePayload = mockUpdateSet.mock.calls[0]![0] as Record<string, unknown>
    expect(updatePayload).not.toHaveProperty('publishedAt')
  })

  it('rejects displayDate in the future', async () => {
    const { updateChangelog } = await import('../changelog.service')
    mockEntryFindFirst.mockResolvedValueOnce(baseEntry())

    await expect(
      updateChangelog(ENTRY_ID, { displayDate: new Date(Date.now() + 60_000) })
    ).rejects.toBeInstanceOf(ValidationError)
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('stores null when displayDate matches publishedAt calendar day', async () => {
    const { updateChangelog } = await import('../changelog.service')
    const sameDay = new Date('2025-06-01T18:00:00Z')

    mockEntryFindFirst.mockResolvedValueOnce(baseEntry()).mockResolvedValueOnce(baseEntry())

    await updateChangelog(ENTRY_ID, { displayDate: sameDay })

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ displayDate: null }))
  })
})
