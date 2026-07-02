import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ChangelogId,
  ChangelogCategoryId,
  ChangelogProductId,
  PrincipalId,
  PostId,
} from '@quackback/ids'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Query-builder spies. Each `db.query.<table>.<method>` and write builder is a
// vi.fn so individual tests can stage per-call return values.
const mockEntryFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockCategoryFindFirst = vi.fn()
const mockProductFindFirst = vi.fn()
const mockEntryPostsFindMany = vi.fn()
const mockPostStatusesFindFirst = vi.fn()
const mockPostsFindMany = vi.fn()

const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

const mockLoggerError = vi.fn()

const mockSlugify = vi.fn()
const mockMarkdownToTiptapJson = vi.fn()
const mockRehostExternalImages = vi.fn()

const mockBuildEventActor = vi.fn()
const mockDispatchChangelogPublished = vi.fn()
const mockDispatchChangelogCreated = vi.fn()
const mockDispatchChangelogUpdated = vi.fn()
const mockDispatchChangelogDeleted = vi.fn()
const mockScheduleDispatch = vi.fn()
const mockCancelScheduledDispatch = vi.fn()

// Table sentinels — referenced by the drizzle operator spies and write builders.
const changelogEntriesTable = {
  id: { name: 'id' },
  deletedAt: { name: 'deleted_at' },
}
const changelogCategoriesTable = { id: 'cat.id', slug: 'cat.slug' }
const changelogProductsTable = { id: 'prod.id', slug: 'prod.slug' }
const changelogEntryPostsTable = { changelogEntryId: 'cep.changelogEntryId' }
const postsTable = { id: 'posts.id' }
const postStatusesTable = { id: 'postStatuses.id' }
const principalTable = { id: 'principal.id' }

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (...args: unknown[]) => mockLoggerError(...args),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

vi.mock('@/lib/shared/utils', () => ({
  slugify: (...args: unknown[]) => mockSlugify(...args),
}))

vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: (...args: unknown[]) => mockMarkdownToTiptapJson(...args),
}))

vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: (...args: unknown[]) => mockRehostExternalImages(...args),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (...args: unknown[]) => mockBuildEventActor(...args),
  dispatchChangelogPublished: (...args: unknown[]) => mockDispatchChangelogPublished(...args),
  dispatchChangelogCreated: (...args: unknown[]) => mockDispatchChangelogCreated(...args),
  dispatchChangelogUpdated: (...args: unknown[]) => mockDispatchChangelogUpdated(...args),
  dispatchChangelogDeleted: (...args: unknown[]) => mockDispatchChangelogDeleted(...args),
}))

vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: (...args: unknown[]) => mockScheduleDispatch(...args),
  cancelScheduledDispatch: (...args: unknown[]) => mockCancelScheduledDispatch(...args),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      changelogEntries: {
        findFirst: (...args: unknown[]) => mockEntryFindFirst(...args),
      },
      principal: {
        findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args),
      },
      changelogCategories: {
        findFirst: (...args: unknown[]) => mockCategoryFindFirst(...args),
      },
      changelogProducts: {
        findFirst: (...args: unknown[]) => mockProductFindFirst(...args),
      },
      changelogEntryPosts: {
        findMany: (...args: unknown[]) => mockEntryPostsFindMany(...args),
      },
      postStatuses: {
        findFirst: (...args: unknown[]) => mockPostStatusesFindFirst(...args),
      },
      posts: {
        findMany: (...args: unknown[]) => mockPostsFindMany(...args),
      },
    },
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  changelogEntries: changelogEntriesTable,
  changelogCategories: changelogCategoriesTable,
  changelogProducts: changelogProductsTable,
  changelogEntryPosts: changelogEntryPostsTable,
  posts: postsTable,
  postStatuses: postStatusesTable,
  principal: principalTable,
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  isNull: vi.fn((col) => ({ kind: 'isNull', col })),
  inArray: vi.fn((col, vals) => ({ kind: 'inArray', col, vals })),
}))

// ---------------------------------------------------------------------------
// Write-builder chain helpers
// ---------------------------------------------------------------------------

/** `db.insert(table).values(...).returning()` -> resolves `rows`. */
function insertReturning(rows: unknown[]) {
  return {
    values: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve(rows)),
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  }
}

/** Plain `db.insert(table).values(...)` -> resolves (link inserts). */
function insertValues() {
  return {
    values: vi.fn(() => Promise.resolve()),
  }
}

/** `db.update(table).set(...).where(...)` -> resolves, also `.returning()`. */
function updateWhere(returningRows: unknown[]) {
  return {
    set: vi.fn(() => ({
      where: vi.fn(() => {
        const p = Promise.resolve() as Promise<unknown> & {
          returning: () => Promise<unknown[]>
        }
        p.returning = () => Promise.resolve(returningRows)
        return p
      }),
    })),
  }
}

/** `db.delete(table).where(...)` -> resolves. */
function deleteWhere() {
  return {
    where: vi.fn(() => Promise.resolve()),
  }
}

// ---------------------------------------------------------------------------
// Stub builders for getChangelogById's reads
// ---------------------------------------------------------------------------

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cl_1' as ChangelogId,
    title: 'Release 1',
    content: 'Body content',
    contentJson: null,
    principalId: 'prn_1' as PrincipalId,
    categoryId: null,
    productId: null,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so any `mockResolvedValueOnce` queued by a
  // test that threw mid-flow does not leak into the next test. Defaults are
  // re-established immediately below.
  vi.resetAllMocks()
  // Default builder return values.
  mockInsert.mockReturnValue(insertValues())
  mockUpdate.mockReturnValue(updateWhere([{ id: 'cl_1' }]))
  mockDelete.mockReturnValue(deleteWhere())

  // Default async leaf reads.
  mockPrincipalFindFirst.mockResolvedValue(null)
  mockCategoryFindFirst.mockResolvedValue(null)
  mockProductFindFirst.mockResolvedValue(null)
  mockEntryPostsFindMany.mockResolvedValue([])
  mockPostStatusesFindFirst.mockResolvedValue(null)
  mockPostsFindMany.mockResolvedValue([])

  // Pure-ish helpers.
  mockSlugify.mockImplementation((s: string) => String(s).toLowerCase().replace(/\W+/g, '-'))
  mockMarkdownToTiptapJson.mockReturnValue({ type: 'doc', content: [] })
  mockRehostExternalImages.mockImplementation(async (json: unknown) => json)

  mockBuildEventActor.mockImplementation((a: { principalId: PrincipalId }) => ({
    type: 'user',
    principalId: a.principalId,
  }))
  mockDispatchChangelogPublished.mockResolvedValue(undefined)
  mockDispatchChangelogCreated.mockResolvedValue(undefined)
  mockDispatchChangelogUpdated.mockResolvedValue(undefined)
  mockDispatchChangelogDeleted.mockResolvedValue(undefined)
  mockScheduleDispatch.mockResolvedValue(undefined)
  mockCancelScheduledDispatch.mockResolvedValue(undefined)
})

// ===========================================================================
// getChangelogById — read mapping, author, category/product summaries, posts
// ===========================================================================

describe('getChangelogById', () => {
  it('maps the full entry with author, category, product, and linked posts', async () => {
    const { getChangelogById } = await import('../changelog.service')

    mockEntryFindFirst.mockResolvedValueOnce(
      entryRow({
        categoryId: 'cat_1' as ChangelogCategoryId,
        productId: 'prod_1' as ChangelogProductId,
      })
    )
    // author present (line 372 branch true)
    mockPrincipalFindFirst.mockResolvedValueOnce({
      id: 'prn_1',
      displayName: 'Author Name',
      avatarUrl: 'http://x/a.png',
    })
    // category + product summaries (lines 538-543, 549-554 both non-null)
    mockCategoryFindFirst.mockResolvedValueOnce({
      id: 'cat_1',
      name: 'Cat',
      slug: 'cat',
      color: '#fff',
    })
    mockProductFindFirst.mockResolvedValueOnce({ id: 'prod_1', name: 'Prod', slug: 'prod' })
    // linked posts: one with a status row, one without statusId
    mockEntryPostsFindMany.mockResolvedValueOnce([
      { post: { id: 'pst_1', title: 'P1', voteCount: 5, statusId: 'sts_1' } },
      { post: { id: 'pst_2', title: 'P2', voteCount: 0, statusId: null } },
    ])
    mockPostStatusesFindFirst.mockResolvedValueOnce({ name: 'Open', color: '#0f0' })

    const result = await getChangelogById('cl_1' as ChangelogId)

    expect(result.id).toBe('cl_1')
    expect(result.author).toEqual({
      id: 'prn_1',
      name: 'Author Name',
      avatarUrl: 'http://x/a.png',
    })
    expect(result.category).toEqual({ id: 'cat_1', name: 'Cat', slug: 'cat', color: '#fff' })
    expect(result.product).toEqual({ id: 'prod_1', name: 'Prod', slug: 'prod' })
    expect(result.categoryId).toBe('cat_1')
    expect(result.productId).toBe('prod_1')
    expect(result.linkedPosts).toEqual([
      { id: 'pst_1', title: 'P1', voteCount: 5, status: { name: 'Open', color: '#0f0' } },
      { id: 'pst_2', title: 'P2', voteCount: 0, status: null },
    ])
    expect(result.status).toBe('published')
  })

  it('returns null summaries when categoryId/productId are null and null author when principal missing', async () => {
    const { getChangelogById } = await import('../changelog.service')

    // categoryId/productId null -> getChangelog*Summary early returns (538, 549 true)
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ principalId: null }))

    const result = await getChangelogById('cl_1' as ChangelogId)

    expect(result.author).toBeNull()
    expect(result.category).toBeNull()
    expect(result.product).toBeNull()
    // principal lookup skipped entirely
    expect(mockPrincipalFindFirst).not.toHaveBeenCalled()
  })

  it('falls back to a status-less linked post when the status row is missing', async () => {
    const { getChangelogById } = await import('../changelog.service')

    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ principalId: null }))
    mockEntryPostsFindMany.mockResolvedValueOnce([
      { post: { id: 'pst_1', title: 'P1', voteCount: 1, statusId: 'sts_x' } },
    ])
    // statusId present but no matching status row (410 branch false)
    mockPostStatusesFindFirst.mockResolvedValueOnce(undefined)

    const result = await getChangelogById('cl_1' as ChangelogId)
    expect(result.linkedPosts[0].status).toBeNull()
  })

  it('leaves author null when the principal has no displayName', async () => {
    const { getChangelogById } = await import('../changelog.service')
    mockEntryFindFirst.mockResolvedValueOnce(entryRow())
    // principal exists but displayName falsy (372 branch false)
    mockPrincipalFindFirst.mockResolvedValueOnce({
      id: 'prn_1',
      displayName: null,
      avatarUrl: null,
    })

    const result = await getChangelogById('cl_1' as ChangelogId)
    expect(result.author).toBeNull()
  })

  it('throws NotFoundError when the entry does not exist', async () => {
    const { getChangelogById } = await import('../changelog.service')
    mockEntryFindFirst.mockResolvedValueOnce(undefined)
    await expect(getChangelogById('cl_missing' as ChangelogId)).rejects.toThrow(/not found/i)
  })
})

// ===========================================================================
// createChangelog — resolve helpers, insert, dispatch/schedule, changelogRef
// ===========================================================================

describe('createChangelog', () => {
  const author = { principalId: 'prn_1' as PrincipalId, name: 'Author' }

  function stageCreatedEntry(entryOverrides: Record<string, unknown> = {}) {
    // db.insert(changelogEntries).values(...).returning() -> [entry]
    mockInsert.mockReturnValueOnce(insertReturning([{ id: 'cl_new', ...entryOverrides }]))
  }

  it('creates a published entry, resolves category/product by name, links posts, and dispatches', async () => {
    const { createChangelog } = await import('../changelog.service')

    stageCreatedEntry({ title: 'New', content: 'Body' })
    // resolveChangelogCategory by name -> existing found (483 branch true)
    mockCategoryFindFirst.mockResolvedValueOnce({ id: 'cat_x' })
    // resolveChangelogProduct by name -> existing found (516 branch true)
    mockProductFindFirst.mockResolvedValueOnce({ id: 'prod_x' })
    // linkPostsToChangelog: posts exist
    mockPostsFindMany.mockResolvedValueOnce([{ id: 'pst_1' }])
    // getChangelogById re-read at the end
    mockEntryFindFirst.mockResolvedValueOnce(
      entryRow({
        id: 'cl_new',
        categoryId: 'cat_x' as ChangelogCategoryId,
        productId: 'prod_x' as ChangelogProductId,
      })
    )
    mockPrincipalFindFirst.mockResolvedValueOnce(null)
    mockCategoryFindFirst.mockResolvedValueOnce({ id: 'cat_x', name: 'C', slug: 'c', color: null })
    mockProductFindFirst.mockResolvedValueOnce({ id: 'prod_x', name: 'P', slug: 'p' })
    mockEntryPostsFindMany.mockResolvedValueOnce([])

    const result = await createChangelog(
      {
        title: '  New  ',
        content: '  Body  ',
        categoryName: 'My Category',
        productName: 'My Product',
        linkedPostIds: ['pst_1' as PostId],
        publishState: { type: 'published' },
      },
      author
    )

    expect(result.id).toBe('cl_new')
    expect(mockDispatchChangelogPublished).toHaveBeenCalledTimes(1)
    expect(mockDispatchChangelogCreated).toHaveBeenCalledTimes(1)
    // changelogRef built from the re-read created entry -> covers 54-64 incl.
    // categoryId/productId/publishedAt/createdAt/updatedAt non-null branches.
    const refArg = mockDispatchChangelogCreated.mock.calls[0][1] as Record<string, unknown>
    expect(refArg.id).toBe('cl_new')
    expect(refArg.categoryId).toBe('cat_x')
    expect(refArg.productId).toBe('prod_x')
    expect(refArg.publishedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('schedules a publish job for a future scheduled state', async () => {
    const { createChangelog } = await import('../changelog.service')

    stageCreatedEntry()
    // no category/product names -> resolve returns the passed ids / null
    mockEntryFindFirst.mockResolvedValueOnce(
      entryRow({ id: 'cl_new', categoryId: null, productId: null, publishedAt: null })
    )

    const future = new Date(Date.now() + 60_000)
    await createChangelog(
      {
        title: 'Sched',
        content: 'Body',
        publishState: { type: 'scheduled', publishAt: future },
      },
      author
    )

    expect(mockScheduleDispatch).toHaveBeenCalledTimes(1)
    const job = mockScheduleDispatch.mock.calls[0][0] as { jobId: string; handler: string }
    expect(job.jobId).toBe('changelog-publish--cl_new')
    expect(job.handler).toBe('__changelog_publish__')
    // changelogRef with null categoryId/productId/publishedAt (58-60,62-63 false sides)
    const refArg = mockDispatchChangelogCreated.mock.calls[0][1] as Record<string, unknown>
    expect(refArg.categoryId).toBeNull()
    expect(refArg.productId).toBeNull()
    expect(refArg.publishedAt).toBeNull()
  })

  it('does not schedule when the scheduled publishAt is in the past', async () => {
    const { createChangelog } = await import('../changelog.service')

    stageCreatedEntry()
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_new' }))

    await createChangelog(
      {
        title: 'Past',
        content: 'Body',
        publishState: { type: 'scheduled', publishAt: new Date(Date.now() - 60_000) },
      },
      author
    )

    expect(mockScheduleDispatch).not.toHaveBeenCalled()
  })

  it('uses provided contentJson without invoking the markdown converter', async () => {
    const { createChangelog } = await import('../changelog.service')

    stageCreatedEntry()
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_new' }))

    await createChangelog(
      {
        title: 'Draft',
        content: 'Body',
        contentJson: { type: 'doc', content: [{ type: 'paragraph' }] } as never,
        publishState: { type: 'draft' },
      },
      author
    )
    expect(mockMarkdownToTiptapJson).not.toHaveBeenCalled()
  })

  it('throws when title is missing', async () => {
    const { createChangelog } = await import('../changelog.service')
    await expect(
      createChangelog({ title: '   ', content: 'Body', publishState: { type: 'draft' } }, author)
    ).rejects.toThrow(/Title is required/)
  })

  it('throws when content is missing', async () => {
    const { createChangelog } = await import('../changelog.service')
    await expect(
      createChangelog({ title: 'T', content: '   ', publishState: { type: 'draft' } }, author)
    ).rejects.toThrow(/Content is required/)
  })

  it('throws when title exceeds 200 characters', async () => {
    const { createChangelog } = await import('../changelog.service')
    await expect(
      createChangelog(
        { title: 'x'.repeat(201), content: 'Body', publishState: { type: 'draft' } },
        author
      )
    ).rejects.toThrow(/200 characters/)
  })
})

// ===========================================================================
// resolveChangelogCategory / resolveChangelogProduct — exercised via create
// ===========================================================================

describe('category/product name resolution', () => {
  const author = { principalId: 'prn_1' as PrincipalId, name: 'Author' }

  it('creates a new category and product when none exist (insert returns a row)', async () => {
    const { createChangelog } = await import('../changelog.service')

    // Insert order matches execution: category, product, then the entry.
    mockInsert
      .mockReturnValueOnce(insertReturning([{ id: 'cat_created' }])) // category
      .mockReturnValueOnce(insertReturning([{ id: 'prod_created' }])) // product
      .mockReturnValueOnce(insertReturning([{ id: 'cl_new' }])) // entry

    // existing lookup misses (483/516 false), insert returns created (490/523 true)
    mockCategoryFindFirst.mockResolvedValueOnce(null)
    mockProductFindFirst.mockResolvedValueOnce(null)

    // final getChangelogById read
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_new' }))

    await createChangelog(
      {
        title: 'T',
        content: 'Body',
        categoryName: 'Brand New Cat',
        productName: 'Brand New Prod',
        publishState: { type: 'draft' },
      },
      author
    )

    // entry + category + product inserts
    expect(mockInsert).toHaveBeenCalledTimes(3)
  })

  it('re-reads after an insert conflict when onConflictDoNothing returns nothing', async () => {
    const { createChangelog } = await import('../changelog.service')

    mockInsert
      .mockReturnValueOnce(insertReturning([])) // category insert -> conflict, no row (490 false)
      .mockReturnValueOnce(insertReturning([])) // product insert -> conflict, no row (523 false)
      .mockReturnValueOnce(insertReturning([{ id: 'cl_new' }])) // entry

    // first existing lookup misses, post-conflict lookup hits (496/529 true)
    mockCategoryFindFirst
      .mockResolvedValueOnce(null) // existing
      .mockResolvedValueOnce({ id: 'cat_after' }) // afterConflict
    mockProductFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'prod_after' })

    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_new' }))

    await createChangelog(
      {
        title: 'T',
        content: 'Body',
        categoryName: 'Conflicty Cat',
        productName: 'Conflicty Prod',
        publishState: { type: 'draft' },
      },
      author
    )
    expect(mockCategoryFindFirst).toHaveBeenCalledTimes(2)
    expect(mockProductFindFirst).toHaveBeenCalledTimes(2)
  })

  it('falls through to categoryId/productId when post-conflict re-read also misses', async () => {
    const { createChangelog } = await import('../changelog.service')

    mockInsert
      .mockReturnValueOnce(insertReturning([])) // category conflict
      .mockReturnValueOnce(insertReturning([])) // product conflict
      .mockReturnValueOnce(insertReturning([{ id: 'cl_new' }])) // entry

    // both lookups miss entirely -> falls to categoryId ?? null (499/532)
    mockCategoryFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    mockProductFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_new' }))

    await createChangelog(
      {
        title: 'T',
        content: 'Body',
        categoryName: 'Ghost Cat',
        productName: 'Ghost Prod',
        categoryId: 'cat_fallback' as ChangelogCategoryId,
        productId: 'prod_fallback' as ChangelogProductId,
        publishState: { type: 'draft' },
      },
      author
    )
    expect(mockEntryFindFirst).toHaveBeenCalled()
  })

  it('throws when a category name slugifies to empty', async () => {
    const { createChangelog } = await import('../changelog.service')
    mockInsert.mockReturnValueOnce(insertReturning([{ id: 'cl_new' }]))
    mockSlugify.mockReturnValueOnce('') // 476 true

    await expect(
      createChangelog(
        {
          title: 'T',
          content: 'Body',
          categoryName: '@@@',
          publishState: { type: 'draft' },
        },
        author
      )
    ).rejects.toThrow(/Category name must contain/)
  })

  it('throws when a product name slugifies to empty', async () => {
    const { createChangelog } = await import('../changelog.service')
    mockInsert.mockReturnValueOnce(insertReturning([{ id: 'cl_new' }]))
    // category resolves fine, product slug empty (509 true)
    mockSlugify.mockReturnValueOnce('valid-cat').mockReturnValueOnce('')
    mockCategoryFindFirst.mockResolvedValueOnce({ id: 'cat_ok' })

    await expect(
      createChangelog(
        {
          title: 'T',
          content: 'Body',
          categoryName: 'Valid Cat',
          productName: '###',
          publishState: { type: 'draft' },
        },
        author
      )
    ).rejects.toThrow(/Product name must contain/)
  })
})

// ===========================================================================
// updateChangelog — category/product resolution, changedFields, dispatch
// ===========================================================================

describe('updateChangelog', () => {
  it('updates category/product by id, replaces links, and dispatches updated', async () => {
    const { updateChangelog } = await import('../changelog.service')

    // existing entry lookup (line 183)
    mockEntryFindFirst.mockResolvedValueOnce(
      entryRow({ id: 'cl_1', principalId: 'prn_1' as PrincipalId })
    )
    // resolveChangelogCategory/Product by id only (no name) -> categoryId ?? null
    // (207 true via categoryId !== undefined, 210 true via productId !== undefined)
    // delete existing links then re-link
    mockDelete.mockReturnValueOnce(deleteWhere())
    mockPostsFindMany.mockResolvedValueOnce([{ id: 'pst_1' }])
    mockInsert.mockReturnValueOnce(insertValues()) // re-link insert

    // final getChangelogById read (line 277)
    mockEntryFindFirst.mockResolvedValueOnce(
      entryRow({
        id: 'cl_1',
        categoryId: 'cat_1' as ChangelogCategoryId,
        productId: 'prod_1' as ChangelogProductId,
      })
    )
    mockPrincipalFindFirst.mockResolvedValueOnce(null)
    mockCategoryFindFirst.mockResolvedValueOnce({ id: 'cat_1', name: 'C', slug: 'c', color: null })
    mockProductFindFirst.mockResolvedValueOnce({ id: 'prod_1', name: 'P', slug: 'p' })
    mockEntryPostsFindMany.mockResolvedValueOnce([])

    const result = await updateChangelog('cl_1' as ChangelogId, {
      title: '  Renamed  ',
      content: '  New body  ',
      categoryId: 'cat_1' as ChangelogCategoryId,
      productId: 'prod_1' as ChangelogProductId,
      linkedPostIds: ['pst_1' as PostId],
    })

    expect(result.id).toBe('cl_1')
    expect(mockDispatchChangelogUpdated).toHaveBeenCalledTimes(1)
    const changed = mockDispatchChangelogUpdated.mock.calls[0][2] as string[]
    expect(changed).toEqual(['title', 'content', 'categoryId', 'productId', 'linkedPostIds'])
    // updateActor built from existing.principalId (295 true side)
    expect(mockBuildEventActor).toHaveBeenCalled()
  })

  it('resolves category/product by name during update', async () => {
    const { updateChangelog } = await import('../changelog.service')

    mockEntryFindFirst.mockResolvedValueOnce(
      entryRow({ id: 'cl_1', principalId: 'prn_1' as PrincipalId })
    )
    // categoryName/productName present -> resolve by name (207/210 via name !== undefined)
    mockCategoryFindFirst.mockResolvedValueOnce({ id: 'cat_byname' })
    mockProductFindFirst.mockResolvedValueOnce({ id: 'prod_byname' })

    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_1' }))

    await updateChangelog('cl_1' as ChangelogId, {
      categoryName: 'Some Cat',
      productName: 'Some Prod',
    })

    const changed = mockDispatchChangelogUpdated.mock.calls[0][2] as string[]
    expect(changed).toEqual(['categoryName', 'productName'])
  })

  it('uses a service actor when the existing entry has no principal', async () => {
    const { updateChangelog } = await import('../changelog.service')

    // existing.principalId null -> updateActor service branch (295 false side)
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_1', principalId: null }))
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_1', principalId: null }))

    await updateChangelog('cl_1' as ChangelogId, { title: 'X' })

    const actor = mockDispatchChangelogUpdated.mock.calls[0][0] as { type: string }
    expect(actor.type).toBe('service')
  })

  it('publishing transition cancels the scheduled job and dispatches published', async () => {
    const { updateChangelog } = await import('../changelog.service')

    mockEntryFindFirst.mockResolvedValueOnce(
      entryRow({ id: 'cl_1', principalId: 'prn_1' as PrincipalId })
    )
    // getChangelogById inside the published branch
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_1' }))
    // final getChangelogById
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_1' }))

    await updateChangelog('cl_1' as ChangelogId, {
      publishState: { type: 'published' },
    })

    expect(mockCancelScheduledDispatch).toHaveBeenCalledWith('changelog-publish--cl_1')
    expect(mockDispatchChangelogPublished).toHaveBeenCalledTimes(1)
  })

  it('scheduling transition schedules a future job', async () => {
    const { updateChangelog } = await import('../changelog.service')

    mockEntryFindFirst.mockResolvedValueOnce(
      entryRow({ id: 'cl_1', principalId: 'prn_1' as PrincipalId })
    )
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_1' }))

    await updateChangelog('cl_1' as ChangelogId, {
      publishState: { type: 'scheduled', publishAt: new Date(Date.now() + 60_000) },
    })

    expect(mockScheduleDispatch).toHaveBeenCalledTimes(1)
  })

  it('draft transition cancels any scheduled job', async () => {
    const { updateChangelog } = await import('../changelog.service')

    mockEntryFindFirst.mockResolvedValueOnce(
      entryRow({ id: 'cl_1', principalId: 'prn_1' as PrincipalId })
    )
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_1' }))

    await updateChangelog('cl_1' as ChangelogId, {
      publishState: { type: 'draft' },
    })

    expect(mockCancelScheduledDispatch).toHaveBeenCalledWith('changelog-publish--cl_1')
    expect(mockScheduleDispatch).not.toHaveBeenCalled()
  })

  it('clears all links when linkedPostIds is an empty array', async () => {
    const { updateChangelog } = await import('../changelog.service')

    mockEntryFindFirst.mockResolvedValueOnce(
      entryRow({ id: 'cl_1', principalId: 'prn_1' as PrincipalId })
    )
    const del = deleteWhere()
    mockDelete.mockReturnValueOnce(del)
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_1' }))

    await updateChangelog('cl_1' as ChangelogId, { linkedPostIds: [] })

    expect(mockDelete).toHaveBeenCalledTimes(1)
    // no re-link insert since the array is empty
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('throws NotFoundError when the entry to update does not exist', async () => {
    const { updateChangelog } = await import('../changelog.service')
    mockEntryFindFirst.mockResolvedValueOnce(undefined)
    await expect(updateChangelog('cl_missing' as ChangelogId, { title: 'X' })).rejects.toThrow(
      /not found/i
    )
  })

  it('throws when an explicit title is blank', async () => {
    const { updateChangelog } = await import('../changelog.service')
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_1' }))
    await expect(updateChangelog('cl_1' as ChangelogId, { title: '   ' })).rejects.toThrow(
      /cannot be empty/
    )
  })

  it('throws when an explicit title exceeds 200 characters', async () => {
    const { updateChangelog } = await import('../changelog.service')
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_1' }))
    await expect(
      updateChangelog('cl_1' as ChangelogId, { title: 'x'.repeat(201) })
    ).rejects.toThrow(/200 characters/)
  })
})

// ===========================================================================
// deleteChangelog — actor selection branches (335-338) + changelogRef on delete
// ===========================================================================

describe('deleteChangelog', () => {
  it('dispatches deleted with an author actor when the snapshot has a principal', async () => {
    const { deleteChangelog } = await import('../changelog.service')

    // getChangelogById snapshot (with principal) -> 335 true
    mockEntryFindFirst.mockResolvedValueOnce(
      entryRow({ id: 'cl_1', principalId: 'prn_1' as PrincipalId })
    )
    mockUpdate.mockReturnValueOnce(updateWhere([{ id: 'cl_1' }]))

    await deleteChangelog('cl_1' as ChangelogId)

    expect(mockDispatchChangelogDeleted).toHaveBeenCalledTimes(1)
    const actor = mockDispatchChangelogDeleted.mock.calls[0][0] as { type: string }
    expect(actor.type).toBe('user')
  })

  it('dispatches deleted with a service actor when the snapshot has no principal', async () => {
    const { deleteChangelog } = await import('../changelog.service')

    // snapshot without principal -> 335 false (service actor)
    mockEntryFindFirst.mockResolvedValueOnce(entryRow({ id: 'cl_1', principalId: null }))
    mockUpdate.mockReturnValueOnce(updateWhere([{ id: 'cl_1' }]))

    await deleteChangelog('cl_1' as ChangelogId)

    const actor = mockDispatchChangelogDeleted.mock.calls[0][0] as { type: string }
    expect(actor.type).toBe('service')
  })

  it('throws NotFoundError when the soft-delete affects no rows', async () => {
    const { deleteChangelog } = await import('../changelog.service')

    // snapshot read fails -> existing null, no dispatch
    mockEntryFindFirst.mockResolvedValueOnce(undefined)
    mockUpdate.mockReturnValueOnce(updateWhere([])) // returning -> [] (line 331 true)

    await expect(deleteChangelog('cl_1' as ChangelogId)).rejects.toThrow(/not found/i)
    expect(mockDispatchChangelogDeleted).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// computeStatus — pure helper, all three branches
// ===========================================================================

describe('computeStatus', () => {
  it('returns draft/scheduled/published depending on publishedAt', async () => {
    const { computeStatus } = await import('../changelog.service')
    expect(computeStatus(null)).toBe('draft')
    expect(computeStatus(new Date(Date.now() + 60_000))).toBe('scheduled')
    expect(computeStatus(new Date(Date.now() - 60_000))).toBe('published')
  })
})
