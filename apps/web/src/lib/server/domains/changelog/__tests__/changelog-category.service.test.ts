import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChangelogCategoryId } from '@quackback/ids'
import { ConflictError, ValidationError, NotFoundError } from '@/lib/shared/errors'

const mockCategoryFindFirst = vi.fn()
const mockCategoryFindMany = vi.fn()
const mockInsertValues = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockDeleteWhere = vi.fn()
const mockSelectFrom = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      changelogCategories: {
        findFirst: (...args: unknown[]) => mockCategoryFindFirst(...args),
        findMany: (...args: unknown[]) => mockCategoryFindMany(...args),
      },
    },
    select: () => ({ from: (...args: unknown[]) => mockSelectFrom(...args) }),
    insert: () => ({
      values: (values: unknown) => {
        mockInsertValues(values)
        return { returning: () => Promise.resolve([{ ...(values as object), id: 'changelog_category_01new' }]) }
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        return {
          where: (...args: unknown[]) => {
            mockUpdateWhere(...args)
            return { returning: () => Promise.resolve([{ id: 'changelog_category_01x', ...(values as object) }]) }
          },
        }
      },
    }),
    delete: () => ({
      where: (...args: unknown[]) => mockDeleteWhere(...args),
    }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  asc: vi.fn(),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => ({
      kind: 'sql',
      strings: Array.from(strings),
    })),
    { raw: vi.fn() }
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockCategoryFindFirst.mockResolvedValue(undefined)
  mockSelectFrom.mockResolvedValue([{ maxPosition: -1 }])
  mockDeleteWhere.mockReturnValue({
    returning: () => Promise.resolve([{ id: 'changelog_category_01x' }]),
  })
})

describe('createChangelogCategory', () => {
  it('creates a category with the next position and defaults', async () => {
    const { createChangelogCategory } = await import('../changelog-category.service')
    mockSelectFrom.mockResolvedValueOnce([{ maxPosition: 2 }])

    const category = await createChangelogCategory({ name: 'Beta', color: '#123456' })

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Beta', color: '#123456', segmentIds: [], position: 3 })
    )
    expect(category.name).toBe('Beta')
  })

  it('rejects a duplicate name case-insensitively', async () => {
    const { createChangelogCategory } = await import('../changelog-category.service')
    mockCategoryFindFirst.mockResolvedValueOnce({ id: 'changelog_category_01existing', name: 'Beta' })

    await expect(createChangelogCategory({ name: 'beta', color: '#123456' })).rejects.toBeInstanceOf(
      ConflictError
    )
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('rejects an invalid hex color', async () => {
    const { createChangelogCategory } = await import('../changelog-category.service')

    await expect(createChangelogCategory({ name: 'Beta', color: 'not-a-color' })).rejects.toBeInstanceOf(
      ValidationError
    )
  })

  it('rejects an empty name', async () => {
    const { createChangelogCategory } = await import('../changelog-category.service')

    await expect(createChangelogCategory({ name: '   ', color: '#123456' })).rejects.toBeInstanceOf(
      ValidationError
    )
  })
})

describe('updateChangelogCategory', () => {
  it('throws NotFoundError when the category does not exist', async () => {
    const { updateChangelogCategory } = await import('../changelog-category.service')
    mockCategoryFindFirst.mockResolvedValueOnce(undefined)

    await expect(
      updateChangelogCategory('changelog_category_01missing' as ChangelogCategoryId, { name: 'X' })
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('updates segmentIds without touching name/color', async () => {
    const { updateChangelogCategory } = await import('../changelog-category.service')
    mockCategoryFindFirst.mockResolvedValueOnce({
      id: 'changelog_category_01x',
      name: 'Beta',
      color: '#123456',
      segmentIds: [],
      position: 0,
    })

    await updateChangelogCategory('changelog_category_01x' as ChangelogCategoryId, {
      segmentIds: ['seg_enterprise'],
    })

    expect(mockUpdateSet).toHaveBeenCalledWith({ segmentIds: ['seg_enterprise'] })
  })
})

describe('deleteChangelogCategory', () => {
  it('throws NotFoundError when nothing was deleted', async () => {
    const { deleteChangelogCategory } = await import('../changelog-category.service')
    mockDeleteWhere.mockReturnValueOnce({ returning: () => Promise.resolve([]) })

    await expect(
      deleteChangelogCategory('changelog_category_01missing' as ChangelogCategoryId)
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('reorderChangelogCategories', () => {
  it('rejects an empty id list', async () => {
    const { reorderChangelogCategories } = await import('../changelog-category.service')
    await expect(reorderChangelogCategories([])).rejects.toBeInstanceOf(ValidationError)
  })
})
