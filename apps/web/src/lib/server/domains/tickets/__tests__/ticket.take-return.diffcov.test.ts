/**
 * Differential-coverage tests for ticket.take-return — take/return wrappers
 * over assignTicket, including the not-found guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ getTicket: vi.fn(), assignTicket: vi.fn() }))

vi.mock('../ticket.service', () => ({
  getTicket: (...a: unknown[]) => m.getTicket(...a),
  assignTicket: (...a: unknown[]) => m.assignTicket(...a),
}))

import { takeTicket, returnTicket } from '../ticket.take-return'

beforeEach(() => {
  vi.clearAllMocks()
  m.getTicket.mockResolvedValue({ updatedAt: new Date('2026-01-01') })
  m.assignTicket.mockResolvedValue({ id: 'ticket_1' })
})

describe('takeTicket / returnTicket', () => {
  it('takeTicket assigns the actor', async () => {
    await takeTicket('ticket_1' as never, 'p_actor' as never)
    expect(m.assignTicket).toHaveBeenCalledWith(
      'ticket_1',
      expect.objectContaining({ assigneePrincipalId: 'p_actor' })
    )
  })
  it('returnTicket clears the assignee', async () => {
    await returnTicket('ticket_1' as never, 'p_actor' as never)
    expect(m.assignTicket).toHaveBeenCalledWith(
      'ticket_1',
      expect.objectContaining({ assigneePrincipalId: null })
    )
  })
  it('both throw when the ticket is missing', async () => {
    m.getTicket.mockResolvedValue(undefined)
    await expect(takeTicket('ticket_1' as never, 'p' as never)).rejects.toThrow('not found')
    await expect(returnTicket('ticket_1' as never, 'p' as never)).rejects.toThrow('not found')
  })
})
