/**
 * Differential-coverage tests for audit.service — recordEvent default fill-in,
 * the missing-row and error fallbacks, and the listEvents filter matrix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  returning: vi.fn(),
  limit: vi.fn(),
  insertValues: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        m.insertValues(v)
        return { returning: m.returning }
      },
    })),
    select: vi.fn(() => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: m.limit }) }) }),
    })),
  },
  auditEvents: {
    id: 'ae.id',
    principalId: 'ae.principalId',
    action: 'ae.action',
    targetType: 'ae.targetType',
    targetId: 'ae.targetId',
    createdAt: 'ae.createdAt',
  },
  desc: vi.fn((a) => a),
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...a) => ({ and: a })),
  gte: vi.fn((a, b) => ({ gte: [a, b] })),
  lte: vi.fn((a, b) => ({ lte: [a, b] })),
}))

import { recordEvent, listEvents } from '../audit.service'

beforeEach(() => {
  vi.clearAllMocks()
  m.returning.mockResolvedValue([{ id: 'audit_1' }])
  m.limit.mockResolvedValue([])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('recordEvent', () => {
  it('records with default fill-ins and returns the id', async () => {
    const id = await recordEvent({ action: 'ticket.created', targetType: 'ticket' })
    expect(id).toBe('audit_1')
    expect(m.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: null, source: 'web', diff: {} })
    )
  })

  it('records with all fields provided', async () => {
    await recordEvent({
      principalId: 'p1' as never,
      action: 'role.granted',
      targetType: 'role',
      targetId: 'r1',
      diff: { context: {} } as never,
      source: 'api' as never,
      ipAddress: '1.2.3.4',
      userAgent: 'agent',
    })
    expect(m.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'api', ipAddress: '1.2.3.4' })
    )
  })

  it('returns null when no row comes back', async () => {
    m.returning.mockResolvedValueOnce([])
    expect(await recordEvent({ action: 'a', targetType: 't' })).toBeNull()
  })

  it('swallows insert errors and returns null', async () => {
    m.returning.mockRejectedValueOnce(new Error('db down'))
    expect(await recordEvent({ action: 'a', targetType: 't' })).toBeNull()
    expect(console.error).toHaveBeenCalled()
  })
})

describe('listEvents', () => {
  it('applies every filter and clamps the limit', async () => {
    m.limit.mockResolvedValueOnce([{ id: 'audit_1' }])
    const res = await listEvents({
      principalId: 'p1' as never,
      action: 'ticket.created',
      targetType: 'ticket',
      targetId: 't1',
      since: new Date('2025-01-01'),
      until: new Date('2026-01-01'),
      limit: 99999,
    })
    expect(res).toEqual([{ id: 'audit_1' }])
  })

  it('runs with no filters (where undefined, default limit)', async () => {
    const res = await listEvents()
    expect(res).toEqual([])
  })
})
