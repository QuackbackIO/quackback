import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HelpCenterCategoryId } from '@quackback/ids'

const insertValuesCalls: unknown[][] = []
const updateSetCalls: unknown[][] = []
const updateWhereCalls: unknown[][] = []

function createInsertChain() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn((...args: unknown[]) => {
    insertValuesCalls.push(args)
    return chain
  })
  chain.returning = vi.fn().mockResolvedValue([
    {
      id: 'category_new1' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started',
      description: null,
      isPublic: true,
      position: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      deletedAt: null,
    },
  ])
  return chain
}

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn((...args: unknown[]) => {
    updateSetCalls.push(args)
    return chain
  })
  chain.where = vi.fn((...args: unknown[]) => {
    updateWhereCalls.push(args)
    return chain
  })
  chain.returning = vi.fn().mockResolvedValue([
    {
      id: 'category_1' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started Updated',
      description: 'Updated desc',
      isPublic: true,
      position: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
      deletedAt: null,
    },
  ])
  return chain
}

const mockCategoryFindFirst = vi.fn()
const mockCategoryFindMany = vi.fn()
const mockSelectFrom = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      helpCenterCategories: {
        findFirst: (...args: unknown[]) => mockCategoryFindFirst(...args),
        findMany: (...args: unknown[]) => mockCategoryFindMany(...args),
      },
      helpCenterArticles: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(() => createInsertChain()),
    update: vi.fn(() => createUpdateChain()),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const self = (await import('@/lib/server/db')).db
      return fn(self)
    }),
    select: vi.fn(() => ({
      from: (...args: unknown[]) => mockSelectFrom(...args),
    })),
  },
  helpCenterCategories: {
    id: 'id',
    slug: 'slug',
    name: 'name',
    deletedAt: 'deleted_at',
    position: 'position',
    isPublic: 'is_public',
    parentId: 'parent_id',
    icon: 'icon',
  },
  helpCenterArticles: {
    id: 'id',
    slug: 'slug',
    title: 'title',
    categoryId: 'category_id',
    deletedAt: 'deleted_at',
    publishedAt: 'published_at',
    createdAt: 'created_at',
  },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  lte: vi.fn(),
  lt: vi.fn(),
  gt: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  sql: vi.fn(() => {
    const stub: { as: (alias: string) => typeof stub } = { as: () => stub }
    return stub
  }),
  inArray: vi.fn(),
}))

let listCategories: typeof import('../help-center.category.service').listCategories
let listPublicCategories: typeof import('../help-center.category.service').listPublicCategories
let getCategoryById: typeof import('../help-center.category.service').getCategoryById
let getCategoryBySlug: typeof import('../help-center.category.service').getCategoryBySlug
let createCategory: typeof import('../help-center.category.service').createCategory
let updateCategory: typeof import('../help-center.category.service').updateCategory
let deleteCategory: typeof import('../help-center.category.service').deleteCategory
let restoreCategory: typeof import('../help-center.category.service').restoreCategory

beforeEach(async () => {
  vi.clearAllMocks()
  insertValuesCalls.length = 0
  updateSetCalls.length = 0
  updateWhereCalls.length = 0

  const mod = await import('../help-center.category.service')
  listCategories = mod.listCategories
  listPublicCategories = mod.listPublicCategories
  getCategoryById = mod.getCategoryById
  getCategoryBySlug = mod.getCategoryBySlug
  createCategory = mod.createCategory
  updateCategory = mod.updateCategory
  deleteCategory = mod.deleteCategory
  restoreCategory = mod.restoreCategory
})

describe('listCategories', () => {
  it('returns categories with article counts', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_1' as HelpCenterCategoryId,
        slug: 'getting-started',
        name: 'Getting Started',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi
          .fn()
          .mockResolvedValue([{ categoryId: 'category_1', totalCount: 3, publishedCount: 3 }]),
      }),
    })

    const result = await listCategories()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Getting Started')
    expect(result[0].articleCount).toBe(3)
  })

  it('returns 0 article count when no articles exist', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_1' as HelpCenterCategoryId,
        slug: 'empty',
        name: 'Empty',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([]),
      }),
    })

    const result = await listCategories()
    expect(result[0].articleCount).toBe(0)
  })

  it('rolls descendant counts up into parent recursiveArticleCount', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_parent' as HelpCenterCategoryId,
        parentId: null,
        slug: 'parent',
        name: 'Parent',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'category_child' as HelpCenterCategoryId,
        parentId: 'category_parent' as HelpCenterCategoryId,
        slug: 'child',
        name: 'Child',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi
          .fn()
          .mockResolvedValue([{ categoryId: 'category_child', totalCount: 4, publishedCount: 3 }]),
      }),
    })

    const result = await listCategories()
    const parent = result.find((c) => c.id === 'category_parent')!
    const child = result.find((c) => c.id === 'category_child')!

    expect(parent.articleCount).toBe(0)
    expect(parent.publishedArticleCount).toBe(0)
    expect(parent.recursiveArticleCount).toBe(4)
    expect(parent.recursivePublishedArticleCount).toBe(3)

    expect(child.articleCount).toBe(4)
    expect(child.recursiveArticleCount).toBe(4)
    expect(child.publishedArticleCount).toBe(3)
    expect(child.recursivePublishedArticleCount).toBe(3)
  })
})

describe('listPublicCategories', () => {
  it('filters to public categories with articles', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_1' as HelpCenterCategoryId,
        slug: 'public',
        name: 'Public',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'category_2' as HelpCenterCategoryId,
        slug: 'private',
        name: 'Private',
        description: null,
        isPublic: false,
        position: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([
          { categoryId: 'category_1', totalCount: 2, publishedCount: 2 },
          { categoryId: 'category_2', totalCount: 1, publishedCount: 1 },
        ]),
      }),
    })

    const result = await listPublicCategories()
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('public')
  })

  it('includes a parent category whose only published articles live under children', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_parent' as HelpCenterCategoryId,
        parentId: null,
        slug: 'parent',
        name: 'Parent',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'category_child' as HelpCenterCategoryId,
        parentId: 'category_parent' as HelpCenterCategoryId,
        slug: 'child',
        name: 'Child',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'category_empty_root' as HelpCenterCategoryId,
        parentId: null,
        slug: 'empty',
        name: 'Empty Root',
        description: null,
        isPublic: true,
        position: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi
          .fn()
          .mockResolvedValue([
            { categoryId: 'category_child', totalCount: 14, publishedCount: 14 },
          ]),
      }),
    })

    const result = await listPublicCategories()
    const slugs = result.map((c) => c.slug).sort()
    expect(slugs).toEqual(['child', 'parent'])

    const parent = result.find((c) => c.slug === 'parent')!
    expect(parent.articleCount).toBe(14)
  })
})

describe('getCategoryById', () => {
  it('returns category when found', async () => {
    const mockCat = {
      id: 'category_1' as HelpCenterCategoryId,
      slug: 'test',
      name: 'Test',
      description: null,
      isPublic: true,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    mockCategoryFindFirst.mockResolvedValue(mockCat)

    const result = await getCategoryById('category_1' as HelpCenterCategoryId)
    expect(result.name).toBe('Test')
  })

  it('throws NotFoundError when category does not exist', async () => {
    mockCategoryFindFirst.mockResolvedValue(null)

    await expect(getCategoryById('category_missing' as HelpCenterCategoryId)).rejects.toMatchObject(
      { code: 'CATEGORY_NOT_FOUND' }
    )
  })
})

describe('getCategoryBySlug', () => {
  it('returns category by slug', async () => {
    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started',
      description: null,
      isPublic: true,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await getCategoryBySlug('getting-started')
    expect(result.slug).toBe('getting-started')
  })

  it('throws NotFoundError when slug not found', async () => {
    mockCategoryFindFirst.mockResolvedValue(null)

    await expect(getCategoryBySlug('nonexistent')).rejects.toMatchObject({
      code: 'CATEGORY_NOT_FOUND',
    })
  })
})

describe('createCategory', () => {
  it('creates a category with auto-generated slug', async () => {
    const result = await createCategory({ name: 'Getting Started' })
    expect(result.id).toBeDefined()
    expect(insertValuesCalls).toHaveLength(1)
  })

  it('throws ValidationError when name is empty', async () => {
    await expect(createCategory({ name: '' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('throws ValidationError when name is whitespace only', async () => {
    await expect(createCategory({ name: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })
})

describe('deleteCategory', () => {
  it('soft deletes the category', async () => {
    mockCategoryFindMany.mockResolvedValue([{ id: 'category_1', parentId: null }])
    const result = await deleteCategory('category_1' as HelpCenterCategoryId)
    expect(result).toBeUndefined()
  })

  it('throws NotFoundError when category does not exist', async () => {
    mockCategoryFindMany.mockResolvedValue([])

    await expect(deleteCategory('category_missing' as HelpCenterCategoryId)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_FOUND',
    })
  })
})

describe('deleteCategory cascade soft-delete', () => {
  it('soft-deletes a leaf category with no descendants', async () => {
    mockCategoryFindMany.mockResolvedValue([{ id: 'leaf', parentId: null }])

    await expect(deleteCategory('leaf' as HelpCenterCategoryId)).resolves.toBeUndefined()
  })

  it('walks descendants and soft-deletes the full subtree including articles', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'a' },
      { id: 'd', parentId: 'b' },
    ])

    await expect(deleteCategory('a' as HelpCenterCategoryId)).resolves.toBeUndefined()

    const inArrayMock = (await import('@/lib/server/db')).inArray as unknown as ReturnType<
      typeof vi.fn
    >
    const idArrayCalls = inArrayMock.mock.calls
      .map((call) => call[1])
      .filter((arg): arg is string[] => Array.isArray(arg))
    const fullSubtreeCalls = idArrayCalls.filter(
      (arr) => arr.length === 4 && ['a', 'b', 'c', 'd'].every((id) => arr.includes(id))
    )
    expect(fullSubtreeCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('throws NotFoundError when the category does not exist', async () => {
    mockCategoryFindMany.mockResolvedValue([])
    await expect(deleteCategory('ghost' as HelpCenterCategoryId)).rejects.toThrow(/not found/i)
  })
})

describe('createCategory with parentId and icon', () => {
  it('passes parentId and icon to the database insert', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'category_parent1', parentId: null },
      { id: 'category_1', parentId: null },
    ])
    const result = await createCategory({
      name: 'Child Category',
      parentId: 'category_parent1',
      icon: 'book',
    })
    expect(result.id).toBeDefined()
    expect(insertValuesCalls).toHaveLength(1)
    const insertedValues = insertValuesCalls[0][0] as Record<string, unknown>
    expect(insertedValues.parentId).toBe('category_parent1')
    expect(insertedValues.icon).toBe('book')
  })

  it('defaults parentId and icon to null when not provided', async () => {
    await createCategory({ name: 'Top Level' })
    expect(insertValuesCalls).toHaveLength(1)
    const insertedValues = insertValuesCalls[0][0] as Record<string, unknown>
    expect(insertedValues.parentId).toBeNull()
    expect(insertedValues.icon).toBeNull()
  })
})

describe('updateCategory with parentId and icon', () => {
  it('passes parentId and icon in the update set', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'category_parent1', parentId: null },
      { id: 'category_1', parentId: null },
    ])
    await updateCategory('category_1' as HelpCenterCategoryId, {
      parentId: 'category_parent1',
      icon: 'star',
    })
    expect(updateSetCalls).toHaveLength(1)
    const setValues = updateSetCalls[0][0] as Record<string, unknown>
    expect(setValues.parentId).toBe('category_parent1')
    expect(setValues.icon).toBe('star')
  })

  it('allows clearing parentId and icon by passing null', async () => {
    mockCategoryFindMany.mockResolvedValue([{ id: 'category_1', parentId: null }])
    await updateCategory('category_1' as HelpCenterCategoryId, {
      parentId: null,
      icon: null,
    })
    expect(updateSetCalls).toHaveLength(1)
    const setValues = updateSetCalls[0][0] as Record<string, unknown>
    expect(setValues.parentId).toBeNull()
    expect(setValues.icon).toBeNull()
  })
})

describe('listPublicCategories returns parentId and icon', () => {
  it('includes parentId and icon in results', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_1' as HelpCenterCategoryId,
        slug: 'public',
        name: 'Public',
        description: null,
        isPublic: true,
        position: 0,
        parentId: 'category_parent1',
        icon: 'book',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi
          .fn()
          .mockResolvedValue([{ categoryId: 'category_1', totalCount: 2, publishedCount: 2 }]),
      }),
    })

    const result = await listPublicCategories()
    expect(result).toHaveLength(1)
    expect(result[0].parentId).toBe('category_parent1')
    expect(result[0].icon).toBe('book')
  })
})

describe('createCategory hierarchy validation', () => {
  it('rejects a parentId that already sits at the maximum depth', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ])
    await expect(createCategory({ name: 'Too Deep', parentId: 'c' })).rejects.toThrow(/depth/i)
  })

  it('allows a parentId at depth 1 (new category would land at depth 2)', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ])
    await expect(createCategory({ name: 'OK', parentId: 'b' })).resolves.toBeDefined()
  })

  it('allows a null parentId (new top-level category)', async () => {
    await expect(createCategory({ name: 'Top' })).resolves.toBeDefined()
  })

  it('rejects a parentId that does not exist', async () => {
    mockCategoryFindMany.mockResolvedValue([])
    await expect(createCategory({ name: 'Orphan', parentId: 'ghost' })).rejects.toThrow(
      /not found/i
    )
  })
})

describe('updateCategory hierarchy validation', () => {
  it('rejects moving a category under itself', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ])
    await expect(updateCategory('a' as HelpCenterCategoryId, { parentId: 'a' })).rejects.toThrow(
      /parent/i
    )
  })

  it('rejects moving a category under its own descendant', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ])
    await expect(updateCategory('a' as HelpCenterCategoryId, { parentId: 'c' })).rejects.toThrow(
      /cycle/i
    )
  })

  it('rejects moving a subtree such that the deepest leaf would exceed MAX_CATEGORY_DEPTH', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'x', parentId: null },
      { id: 'y', parentId: 'x' },
    ])
    await expect(updateCategory('b' as HelpCenterCategoryId, { parentId: 'y' })).rejects.toThrow(
      /depth/i
    )
  })

  it('allows setting parentId to null (promoting to top-level)', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ])
    await expect(
      updateCategory('b' as HelpCenterCategoryId, { parentId: null })
    ).resolves.toBeDefined()
  })
})

describe('restoreCategory', () => {
  function makeRestoredCategoryChain(captureSetCalls?: unknown[][]) {
    const chain: Record<string, unknown> = {}
    chain.set = vi.fn((...args: unknown[]) => {
      if (captureSetCalls) captureSetCalls.push(args)
      return chain
    })
    chain.where = vi.fn().mockReturnValue(chain)
    chain.returning = vi.fn().mockResolvedValue([
      {
        id: 'category_1' as HelpCenterCategoryId,
        slug: 'getting-started',
        name: 'Getting Started',
        description: null,
        isPublic: true,
        position: 0,
        parentId: null,
        icon: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ])
    return chain
  }

  it('restores a deleted category within the 30-day window', async () => {
    const recentDeletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started',
      deletedAt: recentDeletedAt,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })

    const setCallsCapture: unknown[][] = []
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.update).mockReturnValueOnce(makeRestoredCategoryChain(setCallsCapture) as never)

    const result = await restoreCategory('category_1' as HelpCenterCategoryId)
    expect(result.id).toBe('category_1')
    expect(result.deletedAt).toBeNull()
    expect(setCallsCapture.length).toBeGreaterThan(0)
    const setArgs = setCallsCapture[0][0] as Record<string, unknown>
    expect(setArgs.deletedAt).toBeNull()
  })

  it('throws NotFoundError for a non-existent category', async () => {
    mockCategoryFindFirst.mockResolvedValue(null)
    await expect(restoreCategory('category_missing' as HelpCenterCategoryId)).rejects.toMatchObject(
      { code: 'CATEGORY_NOT_FOUND' }
    )
  })

  it('throws ValidationError when category is not deleted', async () => {
    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1' as HelpCenterCategoryId,
      slug: 'live',
      name: 'Live Category',
      deletedAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })
    await expect(restoreCategory('category_1' as HelpCenterCategoryId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('throws ValidationError when category is outside the 30-day restore window', async () => {
    const oldDeletedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1' as HelpCenterCategoryId,
      slug: 'old',
      name: 'Old Category',
      deletedAt: oldDeletedAt,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })
    await expect(restoreCategory('category_1' as HelpCenterCategoryId)).rejects.toMatchObject({
      code: 'RESTORE_EXPIRED',
    })
  })

  it('refuses to restore a child under a still-deleted parent', async () => {
    const recentDeletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    mockCategoryFindFirst.mockResolvedValueOnce({
      id: 'category_child' as HelpCenterCategoryId,
      slug: 'child',
      name: 'Child Category',
      parentId: 'category_parent' as HelpCenterCategoryId,
      deletedAt: recentDeletedAt,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })
    mockCategoryFindFirst.mockResolvedValueOnce({
      id: 'category_parent' as HelpCenterCategoryId,
      deletedAt: recentDeletedAt,
    })
    await expect(restoreCategory('category_child' as HelpCenterCategoryId)).rejects.toMatchObject({
      code: 'PARENT_DELETED',
    })
  })

  it('restores a child when its parent is already active', async () => {
    const recentDeletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    mockCategoryFindFirst.mockResolvedValueOnce({
      id: 'category_child' as HelpCenterCategoryId,
      slug: 'child',
      name: 'Child Category',
      parentId: 'category_parent' as HelpCenterCategoryId,
      deletedAt: recentDeletedAt,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })
    mockCategoryFindFirst.mockResolvedValueOnce({
      id: 'category_parent' as HelpCenterCategoryId,
      deletedAt: null,
    })
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.update).mockReturnValueOnce(makeRestoredCategoryChain() as never)
    const result = await restoreCategory('category_child' as HelpCenterCategoryId)
    expect(result.deletedAt).toBeNull()
  })
})

describe('listCategories with showDeleted option', () => {
  it('returns deleted categories within the 30-day window', async () => {
    const recentDeletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_deleted' as HelpCenterCategoryId,
        slug: 'deleted-cat',
        name: 'Deleted Category',
        description: null,
        isPublic: true,
        position: 0,
        parentId: null,
        icon: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: recentDeletedAt,
        deletedAt: recentDeletedAt,
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([]),
      }),
    })

    const result = await listCategories({ showDeleted: true })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Deleted Category')
    expect(mockCategoryFindMany).toHaveBeenCalledTimes(1)
  })

  it('returns 0 article count for deleted categories with no deleted articles', async () => {
    const recentDeletedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_deleted' as HelpCenterCategoryId,
        slug: 'deleted-cat',
        name: 'Deleted Category',
        description: null,
        isPublic: true,
        position: 0,
        parentId: null,
        icon: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: recentDeletedAt,
        deletedAt: recentDeletedAt,
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([]),
      }),
    })

    const result = await listCategories({ showDeleted: true })
    expect(result[0].articleCount).toBe(0)
  })

  it('returns live categories by default (no options)', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_1' as HelpCenterCategoryId,
        slug: 'live',
        name: 'Live Category',
        description: null,
        isPublic: true,
        position: 0,
        parentId: null,
        icon: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([]),
      }),
    })

    const result = await listCategories()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Live Category')
  })
})
