import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SegmentId, UserId } from '@quackback/ids'

const mockSelect = vi.fn()
const mockSelectDistinct = vi.fn()
const mockUpdate = vi.fn()
const mockInsert = vi.fn()
const mockDelete = vi.fn()
const mockSegmentFindFirst = vi.fn()
const mockSegmentFindMany = vi.fn()
const mockLoggerError = vi.fn()

const settingsTable = {
  changelogVisibilityConfig: 'settings.changelogVisibilityConfig',
}

const userSegmentsTable = {
  principalId: 'userSegments.principalId',
  segmentId: 'userSegments.segmentId',
}

const segmentsTable = {
  id: 'segments.id',
  name: 'segments.name',
}

const changelogSegmentVisibilityTable = {
  id: 'changelogSegmentVisibility.id',
  segmentId: 'changelogSegmentVisibility.segmentId',
  restrictCategories: 'changelogSegmentVisibility.restrictCategories',
  allowedCategoryIds: 'changelogSegmentVisibility.allowedCategoryIds',
  restrictProducts: 'changelogSegmentVisibility.restrictProducts',
  allowedProductIds: 'changelogSegmentVisibility.allowedProductIds',
}

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (...args: unknown[]) => mockLoggerError(...args),
    }),
  },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      changelogSegmentVisibility: {
        findFirst: (...args: unknown[]) => mockSegmentFindFirst(...args),
        findMany: (...args: unknown[]) => mockSegmentFindMany(...args),
      },
    },
    select: (...args: unknown[]) => mockSelect(...args),
    selectDistinct: (...args: unknown[]) => mockSelectDistinct(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  settings: settingsTable,
  userSegments: userSegmentsTable,
  segments: segmentsTable,
  changelogSegmentVisibility: changelogSegmentVisibilityTable,
  eq: vi.fn((column, value) => ({ kind: 'eq', column, value })),
}))

function orgVisibilitySelect(rows: Array<{ changelogVisibilityConfig: string | null }>) {
  return {
    from: vi.fn(() => ({
      limit: vi.fn(() => Promise.resolve(rows)),
    })),
  }
}

function userSegmentsSelect(rows: Array<{ segmentId: SegmentId }>) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          execute: vi.fn(() => Promise.resolve(rows)),
        })),
      })),
    })),
  }
}

function allSegmentVisibilitySelect(
  rows: Array<{
    segmentId: SegmentId
    segmentName: string
    restrictCategories: boolean
    allowedCategoryIds: string[]
    restrictProducts: boolean
    allowedProductIds: string[]
  }>
) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        execute: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
  }
}

function writeChain() {
  return {
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        execute: vi.fn(() => Promise.resolve()),
      })),
      execute: vi.fn(() => Promise.resolve()),
    })),
  }
}

function insertChain() {
  return {
    values: vi.fn(() => ({
      execute: vi.fn(() => Promise.resolve()),
    })),
  }
}

function deleteChain() {
  return {
    where: vi.fn(() => ({
      execute: vi.fn(() => Promise.resolve()),
    })),
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  mockSelect.mockReturnValue(orgVisibilitySelect([]))
  mockSelectDistinct.mockReturnValue(userSegmentsSelect([]))
  mockSegmentFindFirst.mockResolvedValue(null)
  mockSegmentFindMany.mockResolvedValue([])
  mockUpdate.mockReturnValue(writeChain())
  mockInsert.mockReturnValue(insertChain())
  mockDelete.mockReturnValue(deleteChain())
  const { invalidateChangelogVisibilityCache } = await import('../changelog-visibility.service')
  invalidateChangelogVisibilityCache()
})

describe('mergeChangelogVisibilityConfigs', () => {
  it('treats no configs and any unrestricted config as unrestricted visibility', async () => {
    const { mergeChangelogVisibilityConfigs } = await import('../changelog-visibility.service')

    expect(mergeChangelogVisibilityConfigs([])).toEqual({
      allowedCategoryIds: null,
      allowedProductIds: null,
    })
    expect(
      mergeChangelogVisibilityConfigs([
        {
          restrictCategories: true,
          allowedCategoryIds: ['cat_a'],
          restrictProducts: true,
          allowedProductIds: ['prod_a'],
        },
        { restrictCategories: false, restrictProducts: false },
      ])
    ).toEqual({
      allowedCategoryIds: null,
      allowedProductIds: null,
    })
  })

  it('unions allowed category and product ids only when every config restricts them', async () => {
    const { mergeChangelogVisibilityConfigs } = await import('../changelog-visibility.service')

    expect(
      mergeChangelogVisibilityConfigs([
        {
          restrictCategories: true,
          allowedCategoryIds: ['cat_a', 'cat_b'],
          restrictProducts: true,
          allowedProductIds: ['prod_a'],
        },
        {
          restrictCategories: true,
          allowedCategoryIds: ['cat_b', 'cat_c'],
          restrictProducts: true,
          allowedProductIds: ['prod_b'],
        },
      ])
    ).toEqual({
      allowedCategoryIds: ['cat_a', 'cat_b', 'cat_c'],
      allowedProductIds: ['prod_a', 'prod_b'],
    })
  })
})

describe('organization changelog visibility', () => {
  it('parses, normalizes, and caches the org-level visibility config', async () => {
    const { getOrgChangelogVisibility } = await import('../changelog-visibility.service')
    mockSelect.mockReturnValueOnce(
      orgVisibilitySelect([
        {
          changelogVisibilityConfig: JSON.stringify({
            restrictCategories: true,
            allowedCategoryIds: ['cat_a'],
            restrictProducts: 'not-boolean',
            allowedProductIds: 'not-array',
          }),
        },
      ])
    )

    await expect(getOrgChangelogVisibility()).resolves.toEqual({
      restrictCategories: true,
      allowedCategoryIds: ['cat_a'],
      restrictProducts: undefined,
      allowedProductIds: [],
    })
    await expect(getOrgChangelogVisibility()).resolves.toEqual({
      restrictCategories: true,
      allowedCategoryIds: ['cat_a'],
      restrictProducts: undefined,
      allowedProductIds: [],
    })
    expect(mockSelect).toHaveBeenCalledTimes(1)
  })

  it('returns defaults for missing, invalid, and failed org config reads', async () => {
    const { getOrgChangelogVisibility, invalidateChangelogVisibilityCache } =
      await import('../changelog-visibility.service')

    mockSelect.mockReturnValueOnce(orgVisibilitySelect([{ changelogVisibilityConfig: null }]))
    await expect(getOrgChangelogVisibility()).resolves.toEqual({})

    invalidateChangelogVisibilityCache()
    mockSelect.mockReturnValueOnce(
      orgVisibilitySelect([{ changelogVisibilityConfig: '{"bad-json"' }])
    )
    await expect(getOrgChangelogVisibility()).resolves.toEqual({})

    invalidateChangelogVisibilityCache()
    mockSelect.mockImplementationOnce(() => {
      throw new Error('select failed')
    })
    await expect(getOrgChangelogVisibility()).resolves.toEqual({})
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      expect.stringContaining('Failed to fetch org changelog visibility')
    )
  })

  it('updates the org-level config and invalidates the cached read', async () => {
    const { getOrgChangelogVisibility, setOrgChangelogVisibility } =
      await import('../changelog-visibility.service')
    mockSelect.mockReturnValueOnce(
      orgVisibilitySelect([
        {
          changelogVisibilityConfig: JSON.stringify({
            restrictCategories: true,
            allowedCategoryIds: ['cat_old'],
          }),
        },
      ])
    )
    await getOrgChangelogVisibility()

    const update = writeChain()
    mockUpdate.mockReturnValueOnce(update)
    await setOrgChangelogVisibility({
      restrictCategories: true,
      allowedCategoryIds: ['cat_new'],
      restrictProducts: true,
      allowedProductIds: ['prod_new'],
    })

    expect(mockUpdate).toHaveBeenCalledWith(settingsTable)
    expect(update.set).toHaveBeenCalledWith({
      changelogVisibilityConfig: JSON.stringify({
        restrictCategories: true,
        allowedCategoryIds: ['cat_new'],
        restrictProducts: true,
        allowedProductIds: ['prod_new'],
      }),
    })

    mockSelect.mockReturnValueOnce(
      orgVisibilitySelect([
        {
          changelogVisibilityConfig: JSON.stringify({
            restrictCategories: true,
            allowedCategoryIds: ['cat_after_invalidation'],
          }),
        },
      ])
    )
    await expect(getOrgChangelogVisibility()).resolves.toMatchObject({
      allowedCategoryIds: ['cat_after_invalidation'],
    })
    expect(mockSelect).toHaveBeenCalledTimes(2)
  })

  it('wraps org-level update failures', async () => {
    const { setOrgChangelogVisibility } = await import('../changelog-visibility.service')
    mockUpdate.mockImplementationOnce(() => {
      throw new Error('update failed')
    })

    await expect(setOrgChangelogVisibility({ restrictCategories: false })).rejects.toThrow(
      'Failed to update changelog visibility configuration'
    )
  })
})

describe('segment changelog visibility', () => {
  it('returns a segment override when present and null on missing or failed reads', async () => {
    const { getSegmentChangelogVisibility } = await import('../changelog-visibility.service')
    mockSegmentFindFirst.mockResolvedValueOnce({
      restrictCategories: true,
      allowedCategoryIds: ['cat_a'],
      restrictProducts: false,
      allowedProductIds: [],
    })

    await expect(getSegmentChangelogVisibility('seg_a' as SegmentId)).resolves.toEqual({
      restrictCategories: true,
      allowedCategoryIds: ['cat_a'],
      restrictProducts: false,
      allowedProductIds: [],
    })

    mockSegmentFindFirst.mockResolvedValueOnce(null)
    await expect(getSegmentChangelogVisibility('seg_missing' as SegmentId)).resolves.toBeNull()

    mockSegmentFindFirst.mockRejectedValueOnce(new Error('read failed'))
    await expect(getSegmentChangelogVisibility('seg_error' as SegmentId)).resolves.toBeNull()
  })

  it('updates existing segment overrides and inserts missing overrides with default arrays', async () => {
    const { setSegmentChangelogVisibility } = await import('../changelog-visibility.service')
    const update = writeChain()
    mockSegmentFindFirst.mockResolvedValueOnce({ id: 'csv_1' })
    mockUpdate.mockReturnValueOnce(update)

    await setSegmentChangelogVisibility('seg_existing' as SegmentId, {
      restrictCategories: true,
      allowedCategoryIds: ['cat_a'],
      restrictProducts: true,
      allowedProductIds: ['prod_a'],
    })

    expect(mockUpdate).toHaveBeenCalledWith(changelogSegmentVisibilityTable)
    expect(update.set).toHaveBeenCalledWith({
      restrictCategories: true,
      allowedCategoryIds: ['cat_a'],
      restrictProducts: true,
      allowedProductIds: ['prod_a'],
    })

    const insert = insertChain()
    mockSegmentFindFirst.mockResolvedValueOnce(null)
    mockInsert.mockReturnValueOnce(insert)

    await setSegmentChangelogVisibility('seg_new' as SegmentId, {})

    expect(mockInsert).toHaveBeenCalledWith(changelogSegmentVisibilityTable)
    expect(insert.values).toHaveBeenCalledWith({
      segmentId: 'seg_new',
      restrictCategories: false,
      allowedCategoryIds: [],
      restrictProducts: false,
      allowedProductIds: [],
    })
  })

  it('deletes segment overrides and wraps write failures', async () => {
    const { deleteSegmentChangelogVisibility, setSegmentChangelogVisibility } =
      await import('../changelog-visibility.service')
    const deletion = deleteChain()
    mockDelete.mockReturnValueOnce(deletion)

    await deleteSegmentChangelogVisibility('seg_a' as SegmentId)

    expect(mockDelete).toHaveBeenCalledWith(changelogSegmentVisibilityTable)

    mockSegmentFindFirst.mockRejectedValueOnce(new Error('write failed'))
    await expect(setSegmentChangelogVisibility('seg_a' as SegmentId, {})).rejects.toThrow(
      'Failed to update segment changelog visibility'
    )

    mockDelete.mockImplementationOnce(() => {
      throw new Error('delete failed')
    })
    await expect(deleteSegmentChangelogVisibility('seg_a' as SegmentId)).rejects.toThrow(
      'Failed to delete segment changelog visibility'
    )
  })

  it('lists all segment overrides with segment names and returns an empty list on failure', async () => {
    const { getAllSegmentChangelogVisibilities } = await import('../changelog-visibility.service')
    mockSelect.mockReturnValueOnce(
      allSegmentVisibilitySelect([
        {
          segmentId: 'seg_a' as SegmentId,
          segmentName: 'Enterprise',
          restrictCategories: true,
          allowedCategoryIds: ['cat_a'],
          restrictProducts: false,
          allowedProductIds: [],
        },
      ])
    )

    await expect(getAllSegmentChangelogVisibilities()).resolves.toEqual([
      {
        segmentId: 'seg_a',
        segmentName: 'Enterprise',
        config: {
          restrictCategories: true,
          allowedCategoryIds: ['cat_a'],
          restrictProducts: false,
          allowedProductIds: [],
        },
      },
    ])

    mockSelect.mockImplementationOnce(() => {
      throw new Error('list failed')
    })
    await expect(getAllSegmentChangelogVisibilities()).resolves.toEqual([])
  })
})

describe('effective changelog visibility for a portal user', () => {
  it('uses only org defaults when the user has no segment memberships', async () => {
    const { getEffectiveChangelogVisibilityForUser } =
      await import('../changelog-visibility.service')
    mockSelect.mockReturnValueOnce(
      orgVisibilitySelect([
        {
          changelogVisibilityConfig: JSON.stringify({
            restrictCategories: true,
            allowedCategoryIds: ['cat_org'],
            restrictProducts: true,
            allowedProductIds: ['prod_org'],
          }),
        },
      ])
    )
    mockSelectDistinct.mockReturnValueOnce(userSegmentsSelect([]))

    await expect(getEffectiveChangelogVisibilityForUser('user_a' as UserId)).resolves.toEqual({
      allowedCategoryIds: ['cat_org'],
      allowedProductIds: ['prod_org'],
    })
    expect(mockSegmentFindMany).not.toHaveBeenCalled()
  })

  it('unions restrictive org and segment overrides, but keeps unrestricted dimensions open', async () => {
    const { getEffectiveChangelogVisibilityForUser } =
      await import('../changelog-visibility.service')
    mockSelect.mockReturnValueOnce(
      orgVisibilitySelect([
        {
          changelogVisibilityConfig: JSON.stringify({
            restrictCategories: true,
            allowedCategoryIds: ['cat_org'],
            restrictProducts: false,
          }),
        },
      ])
    )
    mockSelectDistinct.mockReturnValueOnce(
      userSegmentsSelect([{ segmentId: 'seg_a' as SegmentId }, { segmentId: 'seg_b' as SegmentId }])
    )
    mockSegmentFindMany.mockResolvedValueOnce([
      {
        restrictCategories: true,
        allowedCategoryIds: ['cat_a'],
        restrictProducts: true,
        allowedProductIds: ['prod_a'],
      },
      {
        restrictCategories: true,
        allowedCategoryIds: ['cat_b'],
        restrictProducts: true,
        allowedProductIds: ['prod_b'],
      },
    ])

    await expect(getEffectiveChangelogVisibilityForUser('user_a' as UserId)).resolves.toEqual({
      allowedCategoryIds: ['cat_org', 'cat_a', 'cat_b'],
      allowedProductIds: null,
    })
    expect(mockSegmentFindMany).toHaveBeenCalledWith({
      where: expect.any(Function),
    })
  })

  it('fails open if effective visibility resolution errors', async () => {
    const { getEffectiveChangelogVisibilityForUser } =
      await import('../changelog-visibility.service')
    mockSelect.mockImplementationOnce(() => {
      throw new Error('org failed')
    })
    mockSelectDistinct.mockImplementationOnce(() => {
      throw new Error('segments failed')
    })

    await expect(getEffectiveChangelogVisibilityForUser('user_a' as UserId)).resolves.toEqual({
      allowedCategoryIds: null,
      allowedProductIds: null,
    })
  })
})
