/**
 * recordTicketActivity is fire-and-forget: a failing insert must neither
 * throw into the caller nor surface as an unhandled rejection — it is logged
 * and swallowed, so an activity write can never break the parent ticket
 * operation. Pure unit test with a mocked db (a real FK failure would abort
 * the db-test-fixture's shared transaction).
 */
import { describe, it, expect, vi } from 'vitest'
import { createId, type TicketId } from '@quackback/ids'

const insertError = new Error('boom: activity insert failed')
const values = vi.fn(() => Promise.reject(insertError))
const insert = vi.fn(() => ({ values }))
const logError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/server/db', () => ({
  db: { insert: () => insert() },
  ticketActivity: {},
  principal: {},
  eq: vi.fn(),
  desc: vi.fn(),
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ error: logError }) },
}))

import { recordTicketActivity } from '../ticket-activity.service'

describe('recordTicketActivity failure isolation', () => {
  it('swallows a failed insert (no throw, no unhandled rejection) and logs it', async () => {
    const ticketId = createId('ticket') as TicketId

    expect(() =>
      recordTicketActivity({
        ticketId,
        principalId: null,
        type: 'status.changed',
        metadata: { fromId: 'a', toId: 'b' },
      })
    ).not.toThrow()

    // Let the rejected insert settle; vitest fails the run on any unhandled
    // rejection, so reaching the assertion proves it was swallowed.
    await new Promise((r) => setTimeout(r, 0))
    expect(insert).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ activity_type: 'status.changed', err: insertError }),
      'failed to record ticket activity'
    )
  })
})
