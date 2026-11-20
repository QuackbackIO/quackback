/**
 * The pure skip rule for a message write, and the event reaction's error
 * handling: the reaction never fails the shared event job.
 */
import { describe, expect, it, vi } from 'vitest'
import type { EventData } from '@/lib/server/events/types'

const { syncPairTicketFirstResponse } = vi.hoisted(() => ({
  syncPairTicketFirstResponse: vi.fn(),
}))
vi.mock('../ticket-first-response', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ticket-first-response')>()),
  syncPairTicketFirstResponse,
}))

import { messageCanMoveFirstResponse } from '../ticket-first-response'
import { recomputePairTicketFirstResponseFromEvent } from '../ticket.event-hooks'

const at = (minute: number) => new Date(Date.UTC(2026, 0, 5, 10, minute))
const message = (minute: number, isInternal = false) => ({ createdAt: at(minute), isInternal })

describe('messageCanMoveFirstResponse', () => {
  it('a note never moves it', () => {
    expect(messageCanMoveFirstResponse(null, message(5, true), 'added')).toBe(false)
    expect(messageCanMoveFirstResponse(at(10), message(5, true), 'removed')).toBe(false)
  })

  it('any public message can move an empty value', () => {
    expect(messageCanMoveFirstResponse(null, message(5), 'added')).toBe(true)
    expect(messageCanMoveFirstResponse(null, message(5), 'removed')).toBe(true)
  })

  it('an added message moves a set value only when earlier than it', () => {
    expect(messageCanMoveFirstResponse(at(10), message(5), 'added')).toBe(true)
    expect(messageCanMoveFirstResponse(at(10), message(10), 'added')).toBe(false)
    expect(messageCanMoveFirstResponse(at(10), message(15), 'added')).toBe(false)
  })

  it('a removed message moves a set value when it is the first reply or earlier', () => {
    expect(messageCanMoveFirstResponse(at(10), message(10), 'removed')).toBe(true)
    expect(messageCanMoveFirstResponse(at(10), message(5), 'removed')).toBe(true)
    expect(messageCanMoveFirstResponse(at(10), message(15), 'removed')).toBe(false)
  })
})

describe('the ticket-first-response reaction', () => {
  it('logs a failed recompute and returns, so the shared event job does not fail', async () => {
    syncPairTicketFirstResponse.mockRejectedValueOnce(new Error('connection reset'))
    const event = {
      type: 'message.created',
      data: { message: { conversationId: 'conversation_1' } },
    } as unknown as EventData
    await expect(recomputePairTicketFirstResponseFromEvent(event)).resolves.toBeUndefined()
    expect(syncPairTicketFirstResponse).toHaveBeenCalledWith('conversation_1')
  })
})
