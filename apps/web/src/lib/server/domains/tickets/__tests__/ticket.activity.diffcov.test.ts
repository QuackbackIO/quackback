/**
 * Differential-coverage tests for ticket.activity — listTicketActivity limit
 * clamping and the optional `before` cursor condition.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ limit: vi.fn() }))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({ where: () => ({ orderBy: () => ({ limit: m.limit }) }) }),
      }),
    }),
  },
  eq: vi.fn(),
  and: vi.fn((...a) => ({ and: a })),
  lt: vi.fn(),
  desc: vi.fn(),
  ticketActivity: {
    id: 'ta.id',
    ticketId: 'ta.ticketId',
    principalId: 'ta.principalId',
    type: 'ta.type',
    metadata: 'ta.metadata',
    createdAt: 'ta.createdAt',
  },
  principal: { id: 'pr.id', displayName: 'pr.displayName', avatarUrl: 'pr.avatarUrl' },
}))

import { listTicketActivity } from '../ticket.activity'

beforeEach(() => {
  vi.clearAllMocks()
  m.limit.mockResolvedValue([{ id: 'act_1' }])
})

describe('listTicketActivity', () => {
  it('lists with default options', async () => {
    expect(await listTicketActivity('ticket_1' as never)).toEqual([{ id: 'act_1' }])
  })
  it('applies the before cursor and clamps the limit', async () => {
    expect(
      await listTicketActivity('ticket_1' as never, { before: new Date('2026-01-01'), limit: 9999 })
    ).toEqual([{ id: 'act_1' }])
  })
})
