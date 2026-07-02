/**
 * Differential-coverage tests for help-center.category.service — list/get
 * (admin + public visibility), create/update with targeted-audience +
 * hierarchy validation, soft-delete cascade, restore guards, and the
 * fireCategoryEvent dispatch branches. Pure tree/visibility/slug helpers run
 * for real; only db/events/logger are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  countSelect: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  txUpdateWhere: vi.fn(),
  dCreated: vi.fn(),
  dUpdated: vi.fn(),
  dDeleted: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { helpCenterCategories: { findMany: m.findMany, findFirst: m.findFirst } },
    select: () => ({ from: () => ({ where: () => ({ groupBy: () => m.countSelect() }) }) }),
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: m.updateReturning }) }) }),
    transaction: async (cb: (t: unknown) => unknown) =>
      cb({ update: () => ({ set: () => ({ where: m.txUpdateWhere }) }) }),
  },
  helpCenterCategories: {
    id: 'hc.id',
    slug: 'hc.slug',
    name: 'hc.name',
    position: 'hc.position',
    deletedAt: 'hc.deletedAt',
    parentId: 'hc.parentId',
  },
  helpCenterArticles: {
    categoryId: 'ha.categoryId',
    publishedAt: 'ha.publishedAt',
    deletedAt: 'ha.deletedAt',
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  asc: vi.fn(),
  inArray: vi.fn(),
  sql: (..._a: unknown[]) => ({ __sql: true, as: () => ({ __sql: true }) }),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchHelpCenterCategoryCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchHelpCenterCategoryUpdated: (...a: unknown[]) => m.dUpdated(...a),
  dispatchHelpCenterCategoryDeleted: (...a: unknown[]) => m.dDeleted(...a),
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn() }) },
}))

import * as svc from '../help-center.category.service'

// fireCategoryEvent is dispatched via `void` (fire-and-forget through a dynamic
// import); flush a macrotask so the dispatch resolves before assertions.
const flush = () => new Promise((r) => setTimeout(r, 0))

const cat = (over: Record<string, unknown> = {}) => ({
  id: 'cat_1',
  slug: 'general',
  name: 'General',
  parentId: null,
  isPublic: true,
  visibility: 'public',
  position: 0,
  allowedSegmentIds: [],
  allowedPrincipalIds: [],
  description: null,
  icon: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.findMany.mockResolvedValue([])
  m.findFirst.mockResolvedValue(undefined)
  m.countSelect.mockResolvedValue([])
  m.insertReturning.mockResolvedValue([cat()])
  m.updateReturning.mockResolvedValue([cat()])
  m.txUpdateWhere.mockResolvedValue(undefined)
})

describe('listCategories', () => {
  it('lists active categories with article counts', async () => {
    m.findMany.mockResolvedValueOnce([cat({ id: 'cat_1' })])
    m.countSelect.mockResolvedValueOnce([{ categoryId: 'cat_1', totalCount: 5, publishedCount: 3 }])
    const res = await svc.listCategories()
    expect(res[0]).toMatchObject({ articleCount: 5, publishedArticleCount: 3 })
  })
  it('lists soft-deleted categories when showDeleted', async () => {
    m.findMany.mockResolvedValueOnce([cat({ id: 'cat_1', deletedAt: new Date() })])
    m.countSelect.mockResolvedValueOnce([])
    const res = await svc.listCategories({ showDeleted: true })
    expect(res[0].articleCount).toBe(0)
  })
})

describe('listPublicCategories', () => {
  it('keeps only categories with published articles the actor can view', async () => {
    m.findMany.mockResolvedValueOnce([cat({ id: 'cat_1' }), cat({ id: 'cat_2' })])
    m.countSelect.mockResolvedValueOnce([{ categoryId: 'cat_1', totalCount: 2, publishedCount: 2 }])
    const res = await svc.listPublicCategories(null)
    expect(res).toHaveLength(1)
    expect(res[0].articleCount).toBe(2)
  })
})

describe('get by id / slug', () => {
  it('getCategoryById returns and throws', async () => {
    m.findFirst.mockResolvedValueOnce(cat())
    expect((await svc.getCategoryById('cat_1' as never)).id).toBe('cat_1')
    m.findFirst.mockResolvedValueOnce(undefined)
    await expect(svc.getCategoryById('cat_x' as never)).rejects.toThrow('not found')
  })
  it('getCategoryBySlug returns and throws', async () => {
    m.findFirst.mockResolvedValueOnce(cat())
    expect((await svc.getCategoryBySlug('general')).slug).toBe('general')
    m.findFirst.mockResolvedValueOnce(undefined)
    await expect(svc.getCategoryBySlug('nope')).rejects.toThrow('not found')
  })
  it('getPublicCategoryBySlug enforces visibility', async () => {
    m.findFirst.mockResolvedValueOnce(cat())
    expect((await svc.getPublicCategoryBySlug('general', null)).slug).toBe('general')
    m.findFirst.mockResolvedValueOnce(undefined)
    await expect(svc.getPublicCategoryBySlug('nope', null)).rejects.toThrow('not found')
  })
})

describe('createCategory', () => {
  it('requires a name', async () => {
    await expect(svc.createCategory({ name: '  ' } as never)).rejects.toThrow('Name is required')
  })
  it('rejects targeted visibility with no audience', async () => {
    await expect(
      svc.createCategory({
        name: 'N',
        visibility: 'targeted',
        allowedSegmentIds: [],
        allowedPrincipalIds: [],
      } as never)
    ).rejects.toThrow('at least one allowed segment')
  })
  it('creates with a slug fallback and defaults, fires created', async () => {
    const res = await svc.createCategory({ name: 'My Category' } as never)
    expect(res.id).toBe('cat_1')
    await flush()
    expect(m.dCreated).toHaveBeenCalled()
  })
  it('validates the hierarchy when a parent is given', async () => {
    m.findMany.mockResolvedValueOnce([{ id: 'parent_1', parentId: null }])
    await svc.createCategory({ name: 'Child', parentId: 'parent_1' } as never)
    expect(m.insertReturning).toHaveBeenCalled()
  })
  it('rejects a missing parent', async () => {
    m.findMany.mockResolvedValueOnce([{ id: 'other', parentId: null }])
    await expect(svc.createCategory({ name: 'Child', parentId: 'ghost' } as never)).rejects.toThrow(
      'not found'
    )
  })
})

describe('updateCategory', () => {
  it('updates fields, validates audience, fires updated', async () => {
    m.findFirst.mockResolvedValueOnce(cat()) // getCategoryById
    m.updateReturning.mockResolvedValueOnce([cat({ name: 'Renamed' })])
    const res = await svc.updateCategory(
      'cat_1' as never,
      {
        name: ' Renamed ',
        slug: 'renamed',
        description: 'd',
        isPublic: true,
        visibility: 'public',
        allowedSegmentIds: [],
        allowedPrincipalIds: [],
        position: 2,
        icon: 'x',
      } as never
    )
    expect(res.name).toBe('Renamed')
    await flush()
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('validates hierarchy on reparent and rejects self-parent', async () => {
    m.findFirst.mockResolvedValueOnce(cat({ id: 'cat_1' }))
    m.findMany.mockResolvedValueOnce([{ id: 'cat_1', parentId: null }])
    await expect(
      svc.updateCategory('cat_1' as never, { parentId: 'cat_1' } as never)
    ).rejects.toThrow('own parent')
  })
  it('throws when the update matches no row', async () => {
    m.findFirst.mockResolvedValueOnce(cat())
    m.updateReturning.mockResolvedValueOnce([])
    await expect(svc.updateCategory('cat_1' as never, { name: 'x' } as never)).rejects.toThrow(
      'not found'
    )
  })
})

describe('deleteCategory', () => {
  it('throws when the category does not exist', async () => {
    m.findMany.mockResolvedValueOnce([{ id: 'other', parentId: null }])
    await expect(svc.deleteCategory('ghost' as never)).rejects.toThrow('not found')
  })
  it('soft-deletes the subtree and fires deleted', async () => {
    m.findMany.mockResolvedValueOnce([{ id: 'cat_1', parentId: null }])
    m.findFirst.mockResolvedValueOnce(cat()) // snapshot via getCategoryById
    await svc.deleteCategory('cat_1' as never)
    expect(m.txUpdateWhere).toHaveBeenCalled()
    await flush()
    expect(m.dDeleted).toHaveBeenCalled()
  })
})

describe('restoreCategory', () => {
  it('throws when missing', async () => {
    m.findFirst.mockResolvedValueOnce(undefined)
    await expect(svc.restoreCategory('cat_1' as never)).rejects.toThrow('not found')
  })
  it('throws when not deleted', async () => {
    m.findFirst.mockResolvedValueOnce(cat({ deletedAt: null }))
    await expect(svc.restoreCategory('cat_1' as never)).rejects.toThrow('not deleted')
  })
  it('throws when the deletion window has expired', async () => {
    m.findFirst.mockResolvedValueOnce(cat({ deletedAt: new Date('2020-01-01') }))
    await expect(svc.restoreCategory('cat_1' as never)).rejects.toThrow('within 30 days')
  })
  it('throws when the parent is still deleted', async () => {
    m.findFirst.mockResolvedValueOnce(cat({ deletedAt: new Date(), parentId: 'parent_1' }))
    m.findFirst.mockResolvedValueOnce({ id: 'parent_1', deletedAt: new Date() })
    await expect(svc.restoreCategory('cat_1' as never)).rejects.toThrow('parent category first')
  })
  it('restores a recently-deleted root category', async () => {
    m.findFirst.mockResolvedValueOnce(cat({ deletedAt: new Date(), parentId: null }))
    m.updateReturning.mockResolvedValueOnce([cat({ deletedAt: null })])
    const res = await svc.restoreCategory('cat_1' as never)
    expect(res.id).toBe('cat_1')
  })
})

describe('fireCategoryEvent failure', () => {
  it('swallows a dispatch error', async () => {
    m.dCreated.mockRejectedValueOnce(new Error('boom'))
    await svc.createCategory({ name: 'N' } as never)
    // no throw == swallowed (fired via void)
    await flush()
    expect(m.dCreated).toHaveBeenCalled()
  })
})
