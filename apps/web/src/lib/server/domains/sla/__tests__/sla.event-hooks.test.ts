/**
 * Unit coverage for the SLA event hook (§4.6): a teammate message settles the
 * first-response clock and then the armed next-response cycle (in that order);
 * a visitor message never settles — it (re-)arms the next-response clock for
 * the fresh customer-message cycle. A close settles time-to-close, entering/
 * leaving 'snoozed' pauses/resumes the clock, and nothing else (lateral status
 * changes, other events) touches any recorder. The status_changed branches
 * carry no actor check by design — pause/resume/close move the clock the same
 * way whether a teammate or a workflow action changed the status, see
 * sla.event-hooks.ts's doc comment.
 *
 * The ticket.status_changed case routes the ticket-side TTR recorders
 * (ticket-sla.service.ts) on the pending/closed CATEGORY axis — the payload's
 * previousStatus/newStatus are already categories, never raw status names.
 * The recorders themselves are covered against a real DB in
 * sla.service.test / ticket-sla.service.test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EventData } from '@/lib/server/events/types'

const {
  recordFirstResponse,
  recordNextResponse,
  rearmNextResponse,
  recordResolution,
  pauseSlaOnSnooze,
  resumeSlaFromSnooze,
} = vi.hoisted(() => ({
  recordFirstResponse: vi.fn().mockResolvedValue(undefined),
  recordNextResponse: vi.fn().mockResolvedValue(undefined),
  rearmNextResponse: vi.fn().mockResolvedValue(undefined),
  recordResolution: vi.fn().mockResolvedValue(undefined),
  pauseSlaOnSnooze: vi.fn().mockResolvedValue(undefined),
  resumeSlaFromSnooze: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../sla.service', () => ({
  recordFirstResponse,
  recordNextResponse,
  rearmNextResponse,
  recordResolution,
  pauseSlaOnSnooze,
  resumeSlaFromSnooze,
}))

const { recordTicketResolution, pauseTicketSlaOnPending, resumeTicketSlaFromPending } = vi.hoisted(
  () => ({
    recordTicketResolution: vi.fn().mockResolvedValue(undefined),
    pauseTicketSlaOnPending: vi.fn().mockResolvedValue(undefined),
    resumeTicketSlaFromPending: vi.fn().mockResolvedValue(undefined),
  })
)
vi.mock('../ticket-sla.service', () => ({
  recordTicketResolution,
  pauseTicketSlaOnPending,
  resumeTicketSlaFromPending,
}))

import { recordSlaFromEvent } from '../sla.event-hooks'

const at = '2026-01-05T10:00:00Z'

function messageCreated(id: string, senderType: 'agent' | 'visitor'): EventData {
  return {
    type: 'message.created',
    timestamp: at,
    data: { message: { conversationId: id, senderType } },
  } as unknown as EventData
}

function statusChanged(id: string, previousStatus: string, newStatus: string): EventData {
  return {
    type: 'conversation.status_changed',
    timestamp: at,
    data: { conversation: { id }, previousStatus, newStatus },
  } as unknown as EventData
}

/** A ticket.status_changed event — previousStatus/newStatus are status
 *  CATEGORIES (events/types.ts's TicketStatusChangedPayload), not raw names. */
function ticketStatusChanged(id: string, previousStatus: string, newStatus: string): EventData {
  return {
    type: 'ticket.status_changed',
    timestamp: at,
    data: { ticket: { id }, previousStatus, newStatus },
  } as unknown as EventData
}

beforeEach(() => vi.clearAllMocks())

describe('recordSlaFromEvent', () => {
  it('settles first response then the armed next-response cycle on a teammate message, at the event time', async () => {
    await recordSlaFromEvent(messageCreated('conversation_1', 'agent'))
    expect(recordFirstResponse).toHaveBeenCalledWith('conversation_1', new Date(at))
    expect(recordNextResponse).toHaveBeenCalledWith('conversation_1', new Date(at))
    expect(rearmNextResponse).not.toHaveBeenCalled()
    expect(recordResolution).not.toHaveBeenCalled()
    // First response settles before the armed cycle (a first reply never
    // double-settles a cycle only a later customer message could have armed).
    const firstOrder = recordFirstResponse.mock.invocationCallOrder[0]
    const nextOrder = recordNextResponse.mock.invocationCallOrder[0]
    expect(firstOrder).toBeLessThan(nextOrder)
  })

  it('re-arms the next-response clock on a visitor message, settling nothing', async () => {
    await recordSlaFromEvent(messageCreated('conversation_1', 'visitor'))
    expect(rearmNextResponse).toHaveBeenCalledWith('conversation_1', new Date(at))
    expect(recordFirstResponse).not.toHaveBeenCalled()
    expect(recordNextResponse).not.toHaveBeenCalled()
  })

  it('settles time-to-close when a conversation closes', async () => {
    await recordSlaFromEvent(statusChanged('conversation_2', 'open', 'closed'))
    // Not a snoozed -> closed move, so no resume ran: the preloaded arg is
    // null and recordResolution's own ?? fallback loads the stamp itself.
    expect(recordResolution).toHaveBeenCalledWith('conversation_2', new Date(at), null)
    expect(pauseSlaOnSnooze).not.toHaveBeenCalled()
    expect(resumeSlaFromSnooze).not.toHaveBeenCalled()
  })

  it('ignores a lateral status change and unrelated events', async () => {
    await recordSlaFromEvent(statusChanged('conversation_2', 'open', 'open'))
    await recordSlaFromEvent(ticketStatusChanged('ticket_9', 'open', 'open'))
    await recordSlaFromEvent({
      type: 'post.created',
      timestamp: at,
      data: {},
    } as unknown as EventData)
    expect(recordFirstResponse).not.toHaveBeenCalled()
    expect(recordNextResponse).not.toHaveBeenCalled()
    expect(rearmNextResponse).not.toHaveBeenCalled()
    expect(recordResolution).not.toHaveBeenCalled()
    expect(pauseSlaOnSnooze).not.toHaveBeenCalled()
    expect(resumeSlaFromSnooze).not.toHaveBeenCalled()
    expect(recordTicketResolution).not.toHaveBeenCalled()
    expect(pauseTicketSlaOnPending).not.toHaveBeenCalled()
    expect(resumeTicketSlaFromPending).not.toHaveBeenCalled()
  })

  it('pauses the clock when a conversation enters snoozed', async () => {
    await recordSlaFromEvent(statusChanged('conversation_3', 'open', 'snoozed'))
    expect(pauseSlaOnSnooze).toHaveBeenCalledWith('conversation_3', new Date(at))
    expect(resumeSlaFromSnooze).not.toHaveBeenCalled()
    expect(recordResolution).not.toHaveBeenCalled()
  })

  it('resumes the clock when a conversation leaves snoozed for open', async () => {
    await recordSlaFromEvent(statusChanged('conversation_3', 'snoozed', 'open'))
    expect(resumeSlaFromSnooze).toHaveBeenCalledWith('conversation_3', new Date(at))
    expect(pauseSlaOnSnooze).not.toHaveBeenCalled()
    expect(recordResolution).not.toHaveBeenCalled()
  })

  it('resumes then resolves on a direct snoozed -> closed move', async () => {
    // Resume was a no-op (nothing was actually paused); recordResolution's own
    // ?? fallback loads the stamp itself in that case.
    resumeSlaFromSnooze.mockResolvedValueOnce(null)
    await recordSlaFromEvent(statusChanged('conversation_3', 'snoozed', 'closed'))
    expect(resumeSlaFromSnooze).toHaveBeenCalledWith('conversation_3', new Date(at))
    expect(recordResolution).toHaveBeenCalledWith('conversation_3', new Date(at), null)
    expect(pauseSlaOnSnooze).not.toHaveBeenCalled()
    // Resume must run before resolve settles against the shifted deadline.
    const resumeOrder = resumeSlaFromSnooze.mock.invocationCallOrder[0]
    const resolveOrder = recordResolution.mock.invocationCallOrder[0]
    expect(resumeOrder).toBeLessThan(resolveOrder)
  })

  it('threads the resumed stamp into recordResolution instead of a second load', async () => {
    const resumedStamp = { policyId: 'sla_1', appliedAt: at, pausedAt: null }
    resumeSlaFromSnooze.mockResolvedValueOnce(resumedStamp)
    await recordSlaFromEvent(statusChanged('conversation_3', 'snoozed', 'closed'))
    expect(recordResolution).toHaveBeenCalledWith('conversation_3', new Date(at), resumedStamp)
  })

  it('does not re-pause a snoozed -> snoozed no-op', async () => {
    await recordSlaFromEvent(statusChanged('conversation_3', 'snoozed', 'snoozed'))
    expect(pauseSlaOnSnooze).not.toHaveBeenCalled()
    expect(resumeSlaFromSnooze).not.toHaveBeenCalled()
  })

  // --- ticket.status_changed: the ticket-side TTR recorders (categories!) ---

  it('settles the ticket TTR clock when a ticket enters the closed category', async () => {
    await recordSlaFromEvent(ticketStatusChanged('ticket_1', 'open', 'closed'))
    // Not a pending -> closed move, so no resume ran: the preloaded arg is
    // null and recordTicketResolution's own ?? fallback loads the stamp itself.
    expect(recordTicketResolution).toHaveBeenCalledWith('ticket_1', new Date(at), null)
    expect(pauseTicketSlaOnPending).not.toHaveBeenCalled()
    expect(resumeTicketSlaFromPending).not.toHaveBeenCalled()
    // The conversation recorders stay out of ticket events entirely.
    expect(recordResolution).not.toHaveBeenCalled()
  })

  it('pauses the ticket TTR clock when a ticket enters the pending category', async () => {
    await recordSlaFromEvent(ticketStatusChanged('ticket_2', 'open', 'pending'))
    expect(pauseTicketSlaOnPending).toHaveBeenCalledWith('ticket_2', new Date(at))
    expect(resumeTicketSlaFromPending).not.toHaveBeenCalled()
    expect(recordTicketResolution).not.toHaveBeenCalled()
  })

  it('resumes the ticket TTR clock when a ticket leaves pending for open', async () => {
    await recordSlaFromEvent(ticketStatusChanged('ticket_2', 'pending', 'open'))
    expect(resumeTicketSlaFromPending).toHaveBeenCalledWith('ticket_2', new Date(at))
    expect(pauseTicketSlaOnPending).not.toHaveBeenCalled()
    expect(recordTicketResolution).not.toHaveBeenCalled()
  })

  it('resumes then resolves on a direct pending -> closed move, resume first', async () => {
    const resumedStamp = { policyId: 'sla_1', appliedAt: at, pausedAt: null }
    resumeTicketSlaFromPending.mockResolvedValueOnce(resumedStamp)
    await recordSlaFromEvent(ticketStatusChanged('ticket_3', 'pending', 'closed'))
    expect(resumeTicketSlaFromPending).toHaveBeenCalledWith('ticket_3', new Date(at))
    // The resume's fresh stamp is threaded into the settle, which then judges
    // against the already-shifted deadline (and skips a second load).
    expect(recordTicketResolution).toHaveBeenCalledWith('ticket_3', new Date(at), resumedStamp)
    expect(pauseTicketSlaOnPending).not.toHaveBeenCalled()
    const resumeOrder = resumeTicketSlaFromPending.mock.invocationCallOrder[0]
    const resolveOrder = recordTicketResolution.mock.invocationCallOrder[0]
    expect(resumeOrder).toBeLessThan(resolveOrder)
  })

  it('does not re-pause a pending -> pending lateral move (categories, not raw status names)', async () => {
    await recordSlaFromEvent(ticketStatusChanged('ticket_4', 'pending', 'pending'))
    expect(pauseTicketSlaOnPending).not.toHaveBeenCalled()
    expect(resumeTicketSlaFromPending).not.toHaveBeenCalled()
    expect(recordTicketResolution).not.toHaveBeenCalled()
  })
})
