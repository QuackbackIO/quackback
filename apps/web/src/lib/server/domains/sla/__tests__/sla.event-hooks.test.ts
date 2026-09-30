/**
 * Unit coverage for the SLA event hook's routing (§4.6). Every reaction first
 * reconciles the pause state with the entity's history (sla.pause-reconcile.ts),
 * then does its clock work: a teammate message settles the first-response
 * clock and then the armed next-response cycle (in that order); a visitor (or
 * service-authored) message never settles, it (re-)arms the next-response
 * clock; a close settles time-to-close. The status branches carry no actor
 * check by design: a workflow action moves the clocks the same way a teammate
 * does, see sla.event-hooks.ts's doc comment.
 *
 * The ticket.status_changed case routes the ticket-side TTR recorders
 * (ticket-sla.service.ts) on the pending/closed CATEGORY axis. The recorders
 * and the reconcile are covered against a real DB elsewhere
 * (sla.service.test, ticket-sla.service.test, sla.pause-span.test,
 * sla.status-reactions.test, sla.ordering.test).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EventData } from '@/lib/server/events/types'

const { recordFirstResponse, recordNextResponse, rearmNextResponse, recordResolution } = vi.hoisted(
  () => ({
    recordFirstResponse: vi.fn().mockResolvedValue(undefined),
    recordNextResponse: vi.fn().mockResolvedValue(undefined),
    rearmNextResponse: vi.fn().mockResolvedValue(undefined),
    recordResolution: vi.fn().mockResolvedValue(undefined),
  })
)
vi.mock('../sla.service', () => ({
  recordFirstResponse,
  recordNextResponse,
  rearmNextResponse,
  recordResolution,
}))

const { recordTicketResolution } = vi.hoisted(() => ({
  recordTicketResolution: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ticket-sla.service', () => ({ recordTicketResolution }))

const { reconcileSnoozePauses, reconcilePendingPauses } = vi.hoisted(() => ({
  reconcileSnoozePauses: vi.fn().mockResolvedValue(undefined),
  reconcilePendingPauses: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../sla.pause-reconcile', () => ({ reconcileSnoozePauses, reconcilePendingPauses }))

import { recordSlaFromEvent } from '../sla.event-hooks'

const at = '2026-01-05T10:00:00Z'
const writtenAt = '2026-01-05T09:59:00.000Z'

function messageCreated(id: string, senderType: 'agent' | 'visitor'): EventData {
  return {
    type: 'message.created',
    timestamp: at,
    data: { message: { conversationId: id, senderType, createdAt: writtenAt } },
  } as unknown as EventData
}

function statusChanged(id: string, previousStatus: string, newStatus: string): EventData {
  return {
    type: 'conversation.status_changed',
    timestamp: at,
    data: { conversation: { id }, previousStatus, newStatus },
  } as unknown as EventData
}

function ticketStatusChanged(id: string, previousStatus: string, newStatus: string): EventData {
  return {
    type: 'ticket.status_changed',
    timestamp: at,
    data: { ticket: { id }, previousStatus, newStatus },
  } as unknown as EventData
}

const order = (fn: { mock: { invocationCallOrder: number[] } }, call = 0) =>
  fn.mock.invocationCallOrder[call]

beforeEach(() => vi.clearAllMocks())

describe('recordSlaFromEvent', () => {
  it('reconciles, then settles first response and then next response on a teammate message, at the message time', async () => {
    await recordSlaFromEvent(messageCreated('conversation_1', 'agent'))

    expect(reconcileSnoozePauses).toHaveBeenCalledWith('conversation_1', new Date(writtenAt))
    expect(recordFirstResponse).toHaveBeenCalledWith('conversation_1', new Date(writtenAt))
    expect(recordNextResponse).toHaveBeenCalledWith('conversation_1', new Date(writtenAt))
    expect(rearmNextResponse).not.toHaveBeenCalled()
    expect(order(reconcileSnoozePauses)).toBeLessThan(order(recordFirstResponse))
    expect(order(recordFirstResponse)).toBeLessThan(order(recordNextResponse))
  })

  it('falls back to the event time when the message payload has no createdAt', async () => {
    await recordSlaFromEvent({
      type: 'message.created',
      timestamp: at,
      data: { message: { conversationId: 'conversation_1', senderType: 'agent' } },
    } as unknown as EventData)
    expect(recordFirstResponse).toHaveBeenCalledWith('conversation_1', new Date(at))
  })

  it('reconciles, then re-arms on a visitor message, settling nothing', async () => {
    await recordSlaFromEvent(messageCreated('conversation_1', 'visitor'))

    expect(reconcileSnoozePauses).toHaveBeenCalledWith('conversation_1', new Date(writtenAt))
    expect(rearmNextResponse).toHaveBeenCalledWith('conversation_1', new Date(writtenAt))
    expect(order(reconcileSnoozePauses)).toBeLessThan(order(rearmNextResponse))
    expect(recordFirstResponse).not.toHaveBeenCalled()
    expect(recordNextResponse).not.toHaveBeenCalled()
  })

  it('never settles on a service-authored agent message', async () => {
    await recordSlaFromEvent({
      ...messageCreated('conversation_1', 'agent'),
      actor: { type: 'service' },
    } as EventData)
    expect(recordFirstResponse).not.toHaveBeenCalled()
    expect(recordNextResponse).not.toHaveBeenCalled()
  })

  it('reconciles on every conversation status change, and settles time-to-close only on a close', async () => {
    await recordSlaFromEvent(statusChanged('conversation_2', 'open', 'snoozed'))
    await recordSlaFromEvent(statusChanged('conversation_2', 'snoozed', 'open'))
    expect(reconcileSnoozePauses).toHaveBeenCalledTimes(2)
    expect(recordResolution).not.toHaveBeenCalled()

    await recordSlaFromEvent(statusChanged('conversation_2', 'snoozed', 'closed'))
    expect(recordResolution).toHaveBeenCalledWith('conversation_2', new Date(at))
    // The close settles after the pause state is up to date.
    expect(order(reconcileSnoozePauses, 2)).toBeLessThan(order(recordResolution))
  })

  it('reconciles on every ticket status change, and settles time-to-resolve only on a close', async () => {
    await recordSlaFromEvent(ticketStatusChanged('ticket_1', 'open', 'pending'))
    await recordSlaFromEvent(ticketStatusChanged('ticket_1', 'pending', 'pending'))
    expect(reconcilePendingPauses).toHaveBeenCalledTimes(2)
    expect(recordTicketResolution).not.toHaveBeenCalled()

    await recordSlaFromEvent(ticketStatusChanged('ticket_1', 'pending', 'closed'))
    expect(recordTicketResolution).toHaveBeenCalledWith('ticket_1', new Date(at))
    expect(order(reconcilePendingPauses, 2)).toBeLessThan(order(recordTicketResolution))
    // The conversation recorders stay out of ticket events entirely.
    expect(reconcileSnoozePauses).not.toHaveBeenCalled()
    expect(recordResolution).not.toHaveBeenCalled()
  })

  it('ignores unrelated events', async () => {
    await recordSlaFromEvent({
      type: 'post.created',
      timestamp: at,
      data: {},
    } as unknown as EventData)
    for (const fn of [
      reconcileSnoozePauses,
      reconcilePendingPauses,
      recordFirstResponse,
      recordNextResponse,
      rearmNextResponse,
      recordResolution,
      recordTicketResolution,
    ]) {
      expect(fn).not.toHaveBeenCalled()
    }
  })
})
