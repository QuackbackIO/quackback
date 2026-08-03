/**
 * Differential-coverage tests for user-attribute.service — list/create/update/
 * delete with validation, the currency-code rules, no-op update, the duplicate
 * (23505) -> Conflict and generic -> InternalError error mapping, and the
 * fire-and-forget dispatch branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  selectOrderBy: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  deleteWhere: vi.fn(),
  dCreated: vi.fn(),
  dUpdated: vi.fn(),
  dDeleted: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { userAttributeDefinitions: { findFirst: m.findFirst } },
    select: () => ({ from: () => ({ orderBy: () => m.selectOrderBy() }) }),
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: m.updateReturning }) }) }),
    delete: () => ({ where: (...a: unknown[]) => m.deleteWhere(...a) }),
  },
  eq: vi.fn(),
  asc: vi.fn(),
  userAttributeDefinitions: { id: 'uad.id', label: 'uad.label' },
}))

vi.mock('@quackback/ids', () => ({ createId: () => 'user_attr_1' }))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => ({ error: vi.fn() }) } }))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchUserAttributeCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchUserAttributeUpdated: (...a: unknown[]) => m.dUpdated(...a),
  dispatchUserAttributeDeleted: (...a: unknown[]) => m.dDeleted(...a),
}))

import {
  listUserAttributes,
  createUserAttribute,
  updateUserAttribute,
  deleteUserAttribute,
} from '../user-attribute.service'

const flush = () => new Promise((r) => setTimeout(r, 0))
const row = (over: Record<string, unknown> = {}) => ({
  id: 'user_attr_1',
  key: 'plan',
  label: 'Plan',
  description: null,
  type: 'text',
  currencyCode: null,
  externalKey: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.findFirst.mockResolvedValue(undefined)
  m.selectOrderBy.mockResolvedValue([row()])
  m.insertReturning.mockResolvedValue([row()])
  m.updateReturning.mockResolvedValue([row()])
  m.deleteWhere.mockResolvedValue(undefined)
})

describe('listUserAttributes', () => {
  it('maps rows', async () => {
    expect(await listUserAttributes()).toEqual([expect.objectContaining({ key: 'plan' })])
  })
  it('wraps db errors in InternalError', async () => {
    m.selectOrderBy.mockRejectedValueOnce(new Error('db down'))
    await expect(listUserAttributes()).rejects.toThrow('Failed to list')
  })
})

describe('createUserAttribute', () => {
  it('requires key and label', async () => {
    await expect(
      createUserAttribute({ key: ' ', label: 'L', type: 'text' } as never)
    ).rejects.toThrow('key is required')
    await expect(
      createUserAttribute({ key: 'k', label: ' ', type: 'text' } as never)
    ).rejects.toThrow('label is required')
  })
  it('requires a currency code for currency attributes', async () => {
    await expect(
      createUserAttribute({ key: 'k', label: 'L', type: 'currency' } as never)
    ).rejects.toThrow('Currency code is required')
  })
  it('creates a currency attribute and fires created', async () => {
    m.insertReturning.mockResolvedValueOnce([row({ type: 'currency', currencyCode: 'USD' })])
    await createUserAttribute({
      key: ' My Plan ',
      label: ' Plan ',
      type: 'currency',
      currencyCode: 'USD',
      externalKey: ' ext ',
    } as never)
    await flush()
    expect(m.dCreated).toHaveBeenCalled()
  })
  it('maps a 23505 unique violation to Conflict', async () => {
    m.insertReturning.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
    await expect(
      createUserAttribute({ key: 'k', label: 'L', type: 'text' } as never)
    ).rejects.toThrow('already exists')
  })
  it('wraps other errors in InternalError', async () => {
    m.insertReturning.mockRejectedValueOnce(new Error('boom'))
    await expect(
      createUserAttribute({ key: 'k', label: 'L', type: 'text' } as never)
    ).rejects.toThrow('Failed to create')
  })
})

describe('updateUserAttribute', () => {
  it('throws when missing', async () => {
    m.findFirst.mockResolvedValueOnce(undefined)
    await expect(updateUserAttribute('ua_1' as never, { label: 'x' } as never)).rejects.toThrow(
      'not found'
    )
  })
  it('applies all fields, clearing currency on type switch, and fires updated', async () => {
    m.findFirst.mockResolvedValueOnce(row({ type: 'currency', currencyCode: 'USD' }))
    await updateUserAttribute(
      'ua_1' as never,
      {
        label: ' New ',
        description: 'd',
        type: 'text',
        externalKey: ' ext ',
      } as never
    )
    await flush()
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('keeps currency code when staying currency / setting it explicitly', async () => {
    m.findFirst.mockResolvedValueOnce(row())
    await updateUserAttribute('ua_1' as never, { type: 'currency', currencyCode: 'EUR' } as never)
    await flush()
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('returns existing unchanged when no fields change', async () => {
    m.findFirst.mockResolvedValueOnce(row({ key: 'keep' }))
    expect(await updateUserAttribute('ua_1' as never, {} as never)).toMatchObject({ key: 'keep' })
    expect(m.updateReturning).not.toHaveBeenCalled()
  })
  it('wraps generic errors in InternalError', async () => {
    m.findFirst.mockResolvedValueOnce(row())
    m.updateReturning.mockRejectedValueOnce(new Error('boom'))
    await expect(updateUserAttribute('ua_1' as never, { label: 'x' } as never)).rejects.toThrow(
      'Failed to update'
    )
  })
})

describe('deleteUserAttribute', () => {
  it('throws when missing', async () => {
    m.findFirst.mockResolvedValueOnce(undefined)
    await expect(deleteUserAttribute('ua_1' as never)).rejects.toThrow('not found')
  })
  it('deletes and fires deleted', async () => {
    m.findFirst.mockResolvedValueOnce(row())
    await deleteUserAttribute('ua_1' as never)
    await flush()
    expect(m.deleteWhere).toHaveBeenCalled()
    expect(m.dDeleted).toHaveBeenCalled()
  })
  it('wraps generic errors in InternalError', async () => {
    m.findFirst.mockResolvedValueOnce(row())
    m.deleteWhere.mockRejectedValueOnce(new Error('boom'))
    await expect(deleteUserAttribute('ua_1' as never)).rejects.toThrow('Failed to delete')
  })
})
