import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChangelogId, PrincipalId } from '@quackback/ids'
import type { EventActor } from '@/lib/server/events/dispatch'

const ENTRY_ID = 'changelog_01test' as ChangelogId
const AUTHOR = { principalId: 'principal_01author' as PrincipalId, name: 'Author' }
const ACTOR: EventActor = { type: 'service', displayName: 'test' }

const mockEntryFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockInsertValues = vi.fn()
const mockChangelogEntryPostsFindMany = vi.fn()

// Rows the claim UPDATE...RETURNING yields (a single row = claim won, [] = lost),
// and the due-entry rows the reconciler's select returns. Mutated per test.
let mockClaimResult: unknown[] = []
let mockDueRows: unknown[] = []

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      changelogEntries: { findFirst: (...args: unknown[]) => mockEntryFindFirst(...args) },
      changelogEntryPosts: {
        findMany: (...args: unknown[]) => mockChangelogEntryPostsFindMany(...args),
      },
      principal: { findFirst: vi.fn().mockResolvedValue(null) },
      postStatuses: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    insert: () => ({
      values: (values: unknown) => {
        mockInsertValues(values)
        return {
          returning: () => Promise.resolve([{ id: ENTRY_ID, title: 'Release', content: 'Body' }]),
        }
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        // `.where()` is both awaitable (plain UPDATE / release) and carries
        // `.returning()` (the atomic claim), mirroring drizzle's builder.
        const p = Promise.resolve(mockClaimResult) as Promise<unknown[]> & {
          returning: () => Promise<unknown[]>
        }
        p.returning = () => Promise.resolve(mockClaimResult)
        return { where: () => p }
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(mockDueRows) }) }),
      }),
    }),
    delete: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
  },
  changelogEntries: {
    id: 'id',
    publishedAt: 'published_at',
    notifiedAt: 'notified_at',
    deletedAt: 'deleted_at',
    principalId: 'principal_id',
  },
  changelogEntryPosts: { changelogEntryId: 'changelog_entry_id', postId: 'post_id' },
  posts: { id: 'posts.id' },
  principal: { id: 'principal.id' },
  postStatuses: { id: 'postStatuses.id' },
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  lte: vi.fn(),
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
  scheduleDispatch: vi.fn().mockResolvedValue(undefined),
  cancelScheduledDispatch: vi.fn().mockResolvedValue(undefined),
}))

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    title: 'Release',
    content: 'Body',
    contentJson: null,
    principalId: null,
    publishedAt: new Date('2025-06-01T12:00:00Z'),
    displayDate: null,
    notifiedAt: null,
    createdAt: new Date('2025-06-01T10:00:00Z'),
    updatedAt: new Date('2025-06-01T10:00:00Z'),
    deletedAt: null,
    viewCount: 0,
    ...overrides,
  }
}

// Flush detached fire-and-forget notify() chains from create/update.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  mockClaimResult = []
  mockDueRows = []
  mockChangelogEntryPostsFindMany.mockResolvedValue([])
  mockEntryFindFirst.mockResolvedValue(baseEntry())
})

describe('notifyChangelogPublished (atomic claim)', () => {
  it('dispatches and returns true when the claim wins', async () => {
    mockClaimResult = [baseEntry()]
    const { notifyChangelogPublished } = await import('../changelog.service')
    const { dispatchChangelogPublished } = await import('@/lib/server/events/dispatch')

    const result = await notifyChangelogPublished(ENTRY_ID, ACTOR)

    expect(result).toBe(true)
    expect(dispatchChangelogPublished).toHaveBeenCalledTimes(1)
    // The payload is built from the claimed row, and rethrow is opted in so an
    // enqueue failure reaches the release path.
    expect(dispatchChangelogPublished).toHaveBeenCalledWith(
      ACTOR,
      expect.objectContaining({
        id: ENTRY_ID,
        title: 'Release',
        contentPreview: 'Body',
        publishedAt: expect.any(Date),
        linkedPostCount: 0,
      }),
      { rethrow: true }
    )
  })

  it('does not dispatch and returns false when the claim matches nothing', async () => {
    mockClaimResult = [] // already notified / not live
    const { notifyChangelogPublished } = await import('../changelog.service')
    const { dispatchChangelogPublished } = await import('@/lib/server/events/dispatch')

    const result = await notifyChangelogPublished(ENTRY_ID, ACTOR)

    expect(result).toBe(false)
    expect(dispatchChangelogPublished).not.toHaveBeenCalled()
  })

  it('releases the claim (notifiedAt back to null) when dispatch fails', async () => {
    mockClaimResult = [baseEntry()]
    const { notifyChangelogPublished } = await import('../changelog.service')
    const { dispatchChangelogPublished } = await import('@/lib/server/events/dispatch')
    vi.mocked(dispatchChangelogPublished).mockRejectedValueOnce(new Error('queue down'))

    const result = await notifyChangelogPublished(ENTRY_ID, ACTOR)

    expect(result).toBe(false)
    // Exactly two writes: the claim (a Date) then the release (null), in order,
    // so the reconciler can retry the entry.
    expect(mockUpdateSet).toHaveBeenCalledTimes(2)
    expect(mockUpdateSet).toHaveBeenNthCalledWith(1, { notifiedAt: expect.any(Date) })
    expect(mockUpdateSet).toHaveBeenNthCalledWith(2, { notifiedAt: null })
  })
})

describe('reconcileChangelogNotifications', () => {
  it('notifies each due entry and returns the count', async () => {
    mockDueRows = [{ id: ENTRY_ID, principalId: null }]
    mockClaimResult = [baseEntry()]
    const { reconcileChangelogNotifications } = await import('../changelog.service')
    const { dispatchChangelogPublished } = await import('@/lib/server/events/dispatch')

    const count = await reconcileChangelogNotifications()

    expect(count).toBe(1)
    expect(dispatchChangelogPublished).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no entries are due', async () => {
    mockDueRows = []
    const { reconcileChangelogNotifications } = await import('../changelog.service')
    const { dispatchChangelogPublished } = await import('@/lib/server/events/dispatch')

    const count = await reconcileChangelogNotifications()

    expect(count).toBe(0)
    expect(dispatchChangelogPublished).not.toHaveBeenCalled()
  })
})

describe('createChangelog wiring', () => {
  it('announces an immediately-published entry', async () => {
    mockClaimResult = [baseEntry()]
    const { createChangelog } = await import('../changelog.service')
    const { dispatchChangelogPublished } = await import('@/lib/server/events/dispatch')

    await createChangelog({ title: 'X', content: 'Y', publishState: { type: 'published' } }, AUTHOR)
    await flush()

    expect(dispatchChangelogPublished).toHaveBeenCalledTimes(1)
  })

  it('schedules (not announces) a scheduled entry', async () => {
    const { createChangelog } = await import('../changelog.service')
    const { dispatchChangelogPublished } = await import('@/lib/server/events/dispatch')
    const { scheduleDispatch } = await import('@/lib/server/events/scheduler')

    await createChangelog(
      {
        title: 'X',
        content: 'Y',
        publishState: { type: 'scheduled', publishAt: new Date(Date.now() + 86_400_000) },
      },
      AUTHOR
    )
    await flush()

    expect(dispatchChangelogPublished).not.toHaveBeenCalled()
    expect(scheduleDispatch).toHaveBeenCalledTimes(1)
  })

  it('does not announce a draft', async () => {
    const { createChangelog } = await import('../changelog.service')
    const { dispatchChangelogPublished } = await import('@/lib/server/events/dispatch')

    await createChangelog({ title: 'X', content: 'Y', publishState: { type: 'draft' } }, AUTHOR)
    await flush()

    expect(dispatchChangelogPublished).not.toHaveBeenCalled()
  })

  it('stores the markdown projection of contentJson so images reach the content column', async () => {
    // Write-time regen: the stored `content` column must carry the image even
    // when the caller-supplied markdown would have, so downstream consumers
    // that read the column directly (webhooks, notifications) get it too.
    const { createChangelog } = await import('../changelog.service')

    await createChangelog(
      {
        title: 'X',
        content: '![Shot](https://cdn.example.com/shot.png)',
        publishState: { type: 'draft' },
      },
      AUTHOR
    )

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('![Shot](https://cdn.example.com/shot.png)'),
      })
    )
  })
})

describe('updateChangelog wiring', () => {
  it('announces on first publish', async () => {
    mockEntryFindFirst.mockResolvedValue(baseEntry({ publishedAt: null, notifiedAt: null }))
    mockClaimResult = [baseEntry()]
    const { updateChangelog } = await import('../changelog.service')
    const { dispatchChangelogPublished } = await import('@/lib/server/events/dispatch')

    await updateChangelog(ENTRY_ID, { publishState: { type: 'published' } })
    await flush()

    expect(dispatchChangelogPublished).toHaveBeenCalledTimes(1)
  })

  it('does not re-announce an already-notified entry (claim matches nothing)', async () => {
    mockEntryFindFirst.mockResolvedValue(
      baseEntry({ notifiedAt: new Date('2025-06-01T12:00:00Z') })
    )
    mockClaimResult = [] // notifiedAt already set, so the claim's WHERE excludes it
    const { updateChangelog } = await import('../changelog.service')
    const { dispatchChangelogPublished } = await import('@/lib/server/events/dispatch')

    await updateChangelog(ENTRY_ID, { publishState: { type: 'published' } })
    await flush()

    expect(dispatchChangelogPublished).not.toHaveBeenCalled()
  })
})
