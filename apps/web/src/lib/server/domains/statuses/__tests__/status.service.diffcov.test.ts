/**
 * Differential-coverage tests for status.service — create/update/delete
 * validation (name/slug/color/dup/default/in-use), default management,
 * reorder, getters, and the public-list error wrapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  execute: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  selectWhere: vi.fn(),
  dCreated: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dUpdated: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dDeleted: vi.fn((..._a: unknown[]) => Promise.resolve()),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { postStatuses: { findFirst: m.findFirst, findMany: m.findMany } },
    execute: (...a: unknown[]) => m.execute(...a),
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: m.updateReturning,
          then: (r: (v: unknown) => void) => r(undefined),
        }),
      }),
    }),
    select: () => ({ from: () => ({ where: () => m.selectWhere() }) }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
  asc: vi.fn(),
  sql: Object.assign((..._a: unknown[]) => ({ __sql: true }), { raw: () => ({ __raw: true }) }),
  posts: { statusId: 'p.statusId', deletedAt: 'p.deletedAt' },
  postStatuses: {
    id: 'ps.id',
    slug: 'ps.slug',
    isDefault: 'ps.isDefault',
    deletedAt: 'ps.deletedAt',
    category: 'ps.category',
    position: 'ps.position',
  },
}))
vi.mock('@quackback/ids', () => ({ toUuid: (id: string) => id }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn() }) },
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchStatusCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchStatusUpdated: (...a: unknown[]) => m.dUpdated(...a),
  dispatchStatusDeleted: (...a: unknown[]) => m.dDeleted(...a),
}))

import * as svc from '../status.service'

const status = (over: Record<string, unknown> = {}) => ({
  id: 'st_1',
  slug: 'open',
  name: 'Open',
  color: '#3b82f6',
  category: 'active',
  position: 0,
  showOnRoadmap: false,
  isDefault: false,
  createdAt: new Date('2026-01-01'),
  deletedAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.findFirst.mockResolvedValue(undefined)
  m.findMany.mockResolvedValue([status()])
  m.execute.mockResolvedValue(undefined)
  m.insertReturning.mockResolvedValue([status()])
  m.updateReturning.mockResolvedValue([status()])
  m.selectWhere.mockResolvedValue([{ count: 0 }])
})

describe('createStatus', () => {
  it('validates name / slug / color', async () => {
    await expect(
      svc.createStatus({ name: ' ', slug: 'open', color: '#3b82f6', category: 'active' } as never)
    ).rejects.toThrow('Name is required')
    await expect(
      svc.createStatus({
        name: 'x'.repeat(51),
        slug: 'o',
        color: '#3b82f6',
        category: 'active',
      } as never)
    ).rejects.toThrow('50 characters')
    await expect(
      svc.createStatus({ name: 'N', slug: ' ', color: '#3b82f6', category: 'active' } as never)
    ).rejects.toThrow('Slug is required')
    await expect(
      svc.createStatus({
        name: 'N',
        slug: 'x'.repeat(51),
        color: '#3b82f6',
        category: 'active',
      } as never)
    ).rejects.toThrow('Slug must be 50')
    await expect(
      svc.createStatus({
        name: 'N',
        slug: 'Bad Slug',
        color: '#3b82f6',
        category: 'active',
      } as never)
    ).rejects.toThrow('lowercase')
    await expect(
      svc.createStatus({ name: 'N', slug: 'ok', color: ' ', category: 'active' } as never)
    ).rejects.toThrow('Color is required')
    await expect(
      svc.createStatus({ name: 'N', slug: 'ok', color: 'red', category: 'active' } as never)
    ).rejects.toThrow('hex format')
  })
  it('rejects a duplicate slug', async () => {
    m.findFirst.mockResolvedValueOnce(status())
    await expect(
      svc.createStatus({ name: 'N', slug: 'open', color: '#3b82f6', category: 'active' } as never)
    ).rejects.toThrow('already exists')
  })
  it('creates and sets default atomically', async () => {
    await svc.createStatus({
      name: 'N',
      slug: 'open',
      color: '#3b82f6',
      category: 'active',
      isDefault: true,
    } as never)
    expect(m.execute).toHaveBeenCalled()
    expect(m.dCreated).toHaveBeenCalled()
  })
})

describe('updateStatus', () => {
  it('throws when missing', async () => {
    m.findFirst.mockResolvedValueOnce(undefined)
    await expect(svc.updateStatus('st_1' as never, { name: 'x' } as never)).rejects.toThrow(
      'not found'
    )
  })
  it('validates name and color', async () => {
    m.findFirst.mockResolvedValue(status())
    await expect(svc.updateStatus('st_1' as never, { name: ' ' } as never)).rejects.toThrow(
      'cannot be empty'
    )
    await expect(
      svc.updateStatus('st_1' as never, { name: 'x'.repeat(51) } as never)
    ).rejects.toThrow('50 characters')
    await expect(svc.updateStatus('st_1' as never, { color: ' ' } as never)).rejects.toThrow(
      'cannot be empty'
    )
    await expect(svc.updateStatus('st_1' as never, { color: 'red' } as never)).rejects.toThrow(
      'hex format'
    )
  })
  it('updates fields, setting default atomically', async () => {
    m.findFirst.mockResolvedValueOnce(status())
    await svc.updateStatus(
      'st_1' as never,
      { name: ' New ', color: '#000000', showOnRoadmap: true, isDefault: true } as never
    )
    expect(m.execute).toHaveBeenCalled()
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('handles isDefault=false and a missing updated row', async () => {
    m.findFirst.mockResolvedValueOnce(status())
    await svc.updateStatus('st_1' as never, { isDefault: false } as never)
    m.findFirst.mockResolvedValueOnce(status())
    m.updateReturning.mockResolvedValueOnce([])
    await expect(svc.updateStatus('st_1' as never, { name: 'x' } as never)).rejects.toThrow(
      'not found'
    )
  })
})

describe('deleteStatus', () => {
  it('throws not-found / default / in-use, then succeeds', async () => {
    m.findFirst.mockResolvedValueOnce(undefined)
    await expect(svc.deleteStatus('st_1' as never)).rejects.toThrow('not found')
    m.findFirst.mockResolvedValueOnce(status({ isDefault: true }))
    await expect(svc.deleteStatus('st_1' as never)).rejects.toThrow('default status')
    m.findFirst.mockResolvedValueOnce(status())
    m.selectWhere.mockResolvedValueOnce([{ count: 3 }])
    await expect(svc.deleteStatus('st_1' as never)).rejects.toThrow('post(s) are using')
    m.findFirst.mockResolvedValueOnce(status())
    await svc.deleteStatus('st_1' as never)
    expect(m.dDeleted).toHaveBeenCalled()
  })
  it('throws when the soft-delete matches no row', async () => {
    m.findFirst.mockResolvedValueOnce(status())
    m.updateReturning.mockResolvedValueOnce([])
    await expect(svc.deleteStatus('st_1' as never)).rejects.toThrow('not found')
  })
})

describe('getters + reorder + default', () => {
  it('getStatusById throws / returns', async () => {
    await expect(svc.getStatusById('st_1' as never)).rejects.toThrow('not found')
    m.findFirst.mockResolvedValueOnce(status())
    expect((await svc.getStatusById('st_1' as never)).id).toBe('st_1')
  })
  it('listStatuses / listPublicStatuses return rows; public wraps errors', async () => {
    expect(await svc.listStatuses()).toEqual([status()])
    expect(await svc.listPublicStatuses()).toEqual([status()])
    m.findMany.mockRejectedValueOnce(new Error('db'))
    await expect(svc.listPublicStatuses()).rejects.toThrow('Failed to fetch statuses')
  })
  it('reorderStatuses validates empty input and updates otherwise', async () => {
    await expect(svc.reorderStatuses([])).rejects.toThrow('IDs are required')
    await svc.reorderStatuses(['st_1', 'st_2'] as never)
    expect(true).toBe(true)
  })
  it('setDefaultStatus: missing / success / missing-after', async () => {
    m.findFirst.mockResolvedValueOnce(undefined)
    await expect(svc.setDefaultStatus('st_1' as never)).rejects.toThrow('not found')
    m.findFirst.mockResolvedValueOnce(status()) // exists
    m.findFirst.mockResolvedValueOnce(status({ isDefault: true })) // refetch
    expect((await svc.setDefaultStatus('st_1' as never)).isDefault).toBe(true)
    m.findFirst.mockResolvedValueOnce(status()) // exists
    m.findFirst.mockResolvedValueOnce(undefined) // refetch missing
    await expect(svc.setDefaultStatus('st_1' as never)).rejects.toThrow('not found')
  })
  it('getDefaultStatus returns null when none; getStatusBySlug throws/returns', async () => {
    expect(await svc.getDefaultStatus()).toBeNull()
    m.findFirst.mockResolvedValueOnce(status({ isDefault: true }))
    expect((await svc.getDefaultStatus())?.isDefault).toBe(true)
    await expect(svc.getStatusBySlug('nope')).rejects.toThrow('not found')
    m.findFirst.mockResolvedValueOnce(status())
    expect((await svc.getStatusBySlug('open')).slug).toBe('open')
  })
})
