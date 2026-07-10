/**
 * Unit coverage for the SLA event hook (§4.6): a teammate message settles the
 * first-response clock (a visitor message doesn't — the only actor-gated
 * branch), a close settles time-to-close, entering/leaving 'snoozed' pauses/
 * resumes the clock, and nothing else (lateral status changes, other events)
 * touches any recorder. The status_changed branches carry no actor check by
 * design — pause/resume/close move the clock the same way whether a teammate
 * or a workflow action changed the status, see sla.event-hooks.ts's doc
 * comment. The recorders themselves are covered against a real DB in
 * sla.service.test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EventData } from '@/lib/server/events/types'

const { recordFirstResponse, recordResolution, pauseSlaOnSnooze, resumeSlaFromSnooze } = vi.hoisted(
  () => ({
    recordFirstResponse: vi.fn().mockResolvedValue(undefined),
    recordResolution: vi.fn().mockResolvedValue(undefined),
    pauseSlaOnSnooze: vi.fn().mockResolvedValue(undefined),
    resumeSlaFromSnooze: vi.fn().mockResolvedValue(undefined),
  })
)
vi.mock('../sla.service', () => ({
  recordFirstResponse,
  recordResolution,
  pauseSlaOnSnooze,
  resumeSlaFromSnooze,
}))

import { recordSlaFromEvent } from '../sla.event-hooks'

const at = '2026-01-05T10:00:00Z'

function statusChanged(id: string, previousStatus: string, newStatus: string): EventData {
  return {
    type: 'conversation.status_changed',
    timestamp: at,
    data: { conversation: { id }, previousStatus, newStatus },
  } as unknown as EventData
}

beforeEach(() => vi.clearAllMocks())

describe('recordSlaFromEvent', () => {
  it('settles first response on a teammate message, at the event time', async () => {
    await recordSlaFromEvent({
      type: 'message.created',
      timestamp: at,
      data: { message: { conversationId: 'conversation_1', senderType: 'agent' } },
    } as unknown as EventData)
    expect(recordFirstResponse).toHaveBeenCalledWith('conversation_1', new Date(at))
    expect(recordResolution).not.toHaveBeenCalled()
  })

  it('ignores a visitor message', async () => {
    await recordSlaFromEvent({
      type: 'message.created',
      timestamp: at,
      data: { message: { conversationId: 'conversation_1', senderType: 'visitor' } },
    } as unknown as EventData)
    expect(recordFirstResponse).not.toHaveBeenCalled()
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
    await recordSlaFromEvent({
      type: 'post.created',
      timestamp: at,
      data: {},
    } as unknown as EventData)
    expect(recordFirstResponse).not.toHaveBeenCalled()
    expect(recordResolution).not.toHaveBeenCalled()
    expect(pauseSlaOnSnooze).not.toHaveBeenCalled()
    expect(resumeSlaFromSnooze).not.toHaveBeenCalled()
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
})
