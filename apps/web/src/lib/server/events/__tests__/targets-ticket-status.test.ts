/**
 * Target resolution for the ticket requester bell (WO-3 slice 4):
 * getTicketStatusChangedTargets. Ports the gating characterization that used
 * to live inline in ticket.service.ts (see
 * domains/tickets/__tests__/ticket.service.test.ts's now-adjacent comment):
 * null-stage silent, same-stage silent, no-requester silent (which also
 * covers a tracker, which carries no requester of its own), and a real
 * crossing resolving stage labels via getStageLabels().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '../types'

const getStageLabels = vi.fn<() => Promise<Record<string, string>>>()
vi.mock('@/lib/server/domains/settings/settings.tickets', () => ({
  getStageLabels: () => getStageLabels(),
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
        title: 'Cannot log in',
        stageLabel: 'Resolved',
        previousStageLabel: 'Received',
      },
    })
    expect(getStageLabels).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when the new stage is null (null-stage silent)', async () => {
    const target = await getTicketStatusChangedTargets(makeEvent({ stage: null }))
    expect(target).toBeNull()
    expect(getStageLabels).not.toHaveBeenCalled()
  })

  it('is a no-op when the stage is unchanged (same-stage silent)', async () => {
    const target = await getTicketStatusChangedTargets(
      makeEvent({ stage: 'received', previousStage: 'received' })
    )
    expect(target).toBeNull()
    expect(getStageLabels).not.toHaveBeenCalled()
  })

  it('is a no-op when there is no requester — also covers a tracker, which has none of its own', async () => {
    const target = await getTicketStatusChangedTargets(makeEvent({ requesterPrincipalId: null }))
    expect(target).toBeNull()
    expect(getStageLabels).not.toHaveBeenCalled()
  })

  it('reports a null previousStageLabel when there was no prior stage', async () => {
    const target = await getTicketStatusChangedTargets(makeEvent({ previousStage: null }))
    expect(target?.config).toMatchObject({ stageLabel: 'Resolved', previousStageLabel: null })
  })
})
