/**
 * Target resolution for the ticket requester bell (WO-3 slice 4):
 * getTicketStatusChangedTargets. Ports the gating characterization that used
 * to live inline in ticket.service.ts (see
 * domains/tickets/__tests__/ticket.service.test.ts's now-adjacent comment):
 * same-stage silent, no-watcher silent (which also covers a tracker, which
 * carries no requester of its own), a real crossing resolving stage labels
 * via getStageLabels(), and — since B18/B22 — the two behavior changes:
 *
 *  - B18: the requester is reached THROUGH their subscription row (the
 *    portal's "Stop watching" deletes it, quieting the bell); they opt back
 *    in by replying (appendRequesterReply re-subscribes).
 *  - B22: a null-stage status move stays silent EXCEPT a fresh crossing into
 *    `closed`, which fires with the generic 'Closed' label so the requester
 *    isn't left at a dead end (the internal status name never leaks).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '../types'

// --- db: the pair lookup (pairConversationId) resolves the converged
// Messages deep link; every select here returns the pair row. ---
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'orderBy']) {
        chain[m] = () => chain
      }
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve([{ conversationId: 'conversation_1' }]).then(res, rej)
      return chain
    },
  },
}))

const getStageLabels = vi.fn<() => Promise<Record<string, string>>>()
vi.mock('@/lib/server/domains/settings/settings.tickets', () => ({
  getStageLabels: () => getStageLabels(),
}))

// Watchers (ticket subscriptions): default to the requester watching — the
// auto-subscribe-at-creation steady state. The B18 opt-out case (an empty
// watcher set) and the union cases live here and in
// targets-ticket-watchers.test.ts respectively.
const getTicketWatchersForEvent = vi.fn<() => Promise<string[]>>()
vi.mock('@/lib/server/domains/tickets/ticket-subscription.service', () => ({
  getTicketWatchersForEvent: () => getTicketWatchersForEvent(),
  getTicketAgentWatchersForEvent: vi.fn().mockResolvedValue([]),
}))

const { getTicketStatusChangedTargets } = await import('../targets')

beforeEach(() => {
  getStageLabels.mockReset()
  getStageLabels.mockResolvedValue({
    received: 'Received',
    in_progress: 'In progress',
    awaiting_requester: 'Awaiting your reply',
    resolved: 'Resolved',
  })
  getTicketWatchersForEvent.mockReset()
  getTicketWatchersForEvent.mockResolvedValue(['principal_requester'])
})

const ticketRef = {
  id: 'ticket_1',
  number: 1,
  type: 'customer' as const,
  priority: 'none' as const,
}

function makeEvent(overrides: Partial<Record<string, unknown>> = {}): EventData {
  return {
    id: 'evt-1',
    type: 'ticket.status_changed',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', principalId: 'principal_actor' },
    data: {
      ticket: ticketRef,
      previousStatus: 'open',
      newStatus: 'closed',
      stage: 'resolved',
      previousStage: 'received',
      requesterPrincipalId: 'principal_requester',
      title: 'Cannot log in',
      ...overrides,
    },
  } as EventData
}

describe('getTicketStatusChangedTargets', () => {
  it('resolves the requester with stage labels on a real crossing', async () => {
    const target = await getTicketStatusChangedTargets(makeEvent())
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_requester'] },
      config: {
        ticketId: 'ticket_1',
        conversationId: 'conversation_1',
        title: 'Cannot log in',
        stageLabel: 'Resolved',
        previousStageLabel: 'Received',
        requesterPrincipalId: 'principal_requester',
      },
    })
    expect(getStageLabels).toHaveBeenCalledTimes(1)
  })

  it('B18: an unwatched requester (no subscription row) gets no bell — "Stop watching" is honored', async () => {
    getTicketWatchersForEvent.mockResolvedValue([])
    const target = await getTicketStatusChangedTargets(makeEvent())
    expect(target).toBeNull()
    expect(getStageLabels).not.toHaveBeenCalled()
  })

  it('B22: a null-stage CROSSING INTO CLOSED fires with the generic Closed label', async () => {
    const target = await getTicketStatusChangedTargets(makeEvent({ stage: null }))
    expect(target).toEqual({
      type: 'notification',
      target: { principalIds: ['principal_requester'] },
      config: {
        ticketId: 'ticket_1',
        conversationId: 'conversation_1',
        title: 'Cannot log in',
        stageLabel: 'Closed',
        previousStageLabel: 'Received',
        requesterPrincipalId: 'principal_requester',
      },
    })
  })

  it('B22: a null-stage close still honors the unwatched requester (B18 applies to the generic close too)', async () => {
    getTicketWatchersForEvent.mockResolvedValue([])
    expect(await getTicketStatusChangedTargets(makeEvent({ stage: null }))).toBeNull()
  })

  it('is a no-op when a null-stage move is NOT a closed crossing (internal churn stays silent)', async () => {
    const target = await getTicketStatusChangedTargets(
      makeEvent({ stage: null, newStatus: 'open', previousStatus: 'open' })
    )
    expect(target).toBeNull()
    expect(getStageLabels).not.toHaveBeenCalled()
  })

  it('is a no-op on a closed->closed move between two null-stage statuses', async () => {
    const target = await getTicketStatusChangedTargets(
      makeEvent({ stage: null, previousStatus: 'closed', newStatus: 'closed' })
    )
    expect(target).toBeNull()
    expect(getStageLabels).not.toHaveBeenCalled()
  })

  it('is a no-op when the stage is unchanged (same-stage silent)', async () => {
    const target = await getTicketStatusChangedTargets(
      makeEvent({ stage: 'received', previousStage: 'received', newStatus: 'open' })
    )
    expect(target).toBeNull()
    expect(getStageLabels).not.toHaveBeenCalled()
  })

  it('is a no-op when there is no requester AND no watchers — also covers a tracker, which has none of its own', async () => {
    getTicketWatchersForEvent.mockResolvedValue([])
    const target = await getTicketStatusChangedTargets(makeEvent({ requesterPrincipalId: null }))
    expect(target).toBeNull()
    expect(getStageLabels).not.toHaveBeenCalled()
  })

  it('reports a null previousStageLabel when there was no prior stage', async () => {
    const target = await getTicketStatusChangedTargets(makeEvent({ previousStage: null }))
    expect(target?.config).toMatchObject({ stageLabel: 'Resolved', previousStageLabel: null })
  })
})
