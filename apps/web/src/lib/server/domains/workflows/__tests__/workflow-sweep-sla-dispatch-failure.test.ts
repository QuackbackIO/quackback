/**
 * Regression coverage for claim-after-enqueue's failure half (see
 * workflow-sweep.ts's sweepSlaTimerTriggers doc): when a scanned SLA timer
 * candidate's dispatch enqueue actually fails, the fire-once marker must stay
 * unclaimed so a later tick retries — never claimed anyway.
 *
 * workflow-sweep.test.ts mocks '@/lib/server/events/dispatch' wholesale
 * (its dispatch* functions are plain vi.fn()s that always resolve), which
 * hides exactly this failure path: a real dispatch failure never reaches
 * those stubs. This file exercises the REAL dispatch.ts -> process.ts
 * pipeline and stubs only the narrowest real seam — outbox-dispatch's
 * writeEventToOutbox — to force a genuine enqueue failure, the same seam
 * process.test.ts and dispatch-outbox-parity.test.ts already use.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { workflows } from '@/lib/server/db'
import type { ConversationId, SlaPolicyId } from '@quackback/ids'
import type { WorkflowGraph } from '../graph'
import type { EventConversationRef } from '@/lib/server/events/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const mockLogError = vi.fn()
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (...args: unknown[]) => mockLogError(...args),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

// The narrowest real seam: force the durable outbox write itself to reject.
// dispatch.ts and process.ts are NOT mocked, so a rejection here is a genuine
// enqueue failure surfacing through the real pipeline, exactly as a real
// outbox write failure would.
const outboxError = new Error('outbox write failed (simulated)')
const mockWriteEventToOutbox = vi.fn().mockRejectedValue(outboxError)
vi.mock('@/lib/server/events/outbox-dispatch', () => ({
  writeEventToOutbox: (...args: unknown[]) => mockWriteEventToOutbox(...args),
}))

// The SLA domain's own scan/claim correctness is covered elsewhere
// (sla.service.timer-triggers.test.ts); here only the orchestration around a
// FAILED dispatch is under test, so the scan is stubbed to hand back one
// fixed candidate and the claim is a spy workflow-sweep.ts must not call.
const { sweepApproachingSlaBreaches, sweepSlaBreachTriggers, claimSlaTimerTriggerMarker } =
  vi.hoisted(() => ({
    sweepApproachingSlaBreaches: vi.fn().mockResolvedValue([]),
    sweepSlaBreachTriggers: vi.fn().mockResolvedValue([]),
    claimSlaTimerTriggerMarker: vi.fn().mockResolvedValue(true),
  }))
vi.mock('@/lib/server/domains/sla/sla.sweep', () => ({
  sweepApproachingSlaBreaches,
  sweepSlaBreachTriggers,
  claimSlaTimerTriggerMarker,
}))

// The ticket-anchored TTR twins — kept empty so only the conversation-clock
// pass under test fires; not the object of this regression.
const {
  sweepApproachingTicketSlaBreaches,
  sweepTicketSlaBreachTriggers,
  claimTicketSlaTimerTriggerMarker,
} = vi.hoisted(() => ({
  sweepApproachingTicketSlaBreaches: vi.fn().mockResolvedValue([]),
  sweepTicketSlaBreachTriggers: vi.fn().mockResolvedValue([]),
  claimTicketSlaTimerTriggerMarker: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/server/domains/sla/ticket-sla.sweep', () => ({
  sweepApproachingTicketSlaBreaches,
  sweepTicketSlaBreachTriggers,
  claimTicketSlaTimerTriggerMarker,
}))

import { createWorkflow, setWorkflowStatus } from '../workflow.service'
import { sweepSlaTimerTriggers } from '../workflow-sweep'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflows.id }).from(workflows).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const emptyGraph: WorkflowGraph = { nodes: [], edges: [] }

async function seedLiveTimerWorkflow(triggerType: string) {
  const wf = await createWorkflow({
    name: `sla dispatch-failure test ${suffix()}`,
    class: 'background',
    triggerType,
    triggerSettings: {},
    graph: emptyGraph,
  })
  return setWorkflowStatus(wf.id, 'live')
}

const conversationRef: EventConversationRef = {
  id: 'conv_1',
  status: 'open',
  channel: 'messenger',
  priority: 'none',
  assignedTeamId: null,
}

function approachingCandidate() {
  return {
    conversationId: 'conv_1' as ConversationId,
    conversation: conversationRef,
    policyId: 'sla_policy_1' as SlaPolicyId,
    clock: 'first_response' as const,
    dueAt: '2026-01-05T12:00:00.000Z',
    appliedAt: '2026-01-05T10:00:00.000Z',
  }
}

function breachedCandidate() {
  return {
    conversationId: 'conv_1' as ConversationId,
    conversation: conversationRef,
    policyId: 'sla_policy_1' as SlaPolicyId,
    clock: 'first_response' as const,
    dueAt: '2026-01-05T12:00:00.000Z',
    appliedAt: '2026-01-05T10:00:00.000Z',
  }
}

beforeEach(() => {
  mockLogError.mockClear()
  mockWriteEventToOutbox.mockClear().mockRejectedValue(outboxError)
  sweepApproachingSlaBreaches.mockReset().mockResolvedValue([])
  sweepSlaBreachTriggers.mockReset().mockResolvedValue([])
  claimSlaTimerTriggerMarker.mockReset().mockResolvedValue(true)
  sweepApproachingTicketSlaBreaches.mockReset().mockResolvedValue([])
  sweepTicketSlaBreachTriggers.mockReset().mockResolvedValue([])
  claimTicketSlaTimerTriggerMarker.mockReset().mockResolvedValue(true)
})

describe.skipIf(!fixture.available)(
  'sweepSlaTimerTriggers — dispatch failure leaves the marker unclaimed',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    it('does not claim the warning marker when the outbox write for sla.approaching_breach fails', async () => {
      await seedLiveTimerWorkflow('sla.approaching_breach')
      sweepApproachingSlaBreaches.mockResolvedValue([approachingCandidate()])

      const fired = await sweepSlaTimerTriggers(new Date('2026-01-05T11:55:00Z'))

      expect(mockWriteEventToOutbox).toHaveBeenCalledTimes(1)
      // The candidate's dispatch failed, so it must not count as fired and
      // the fire-once marker must stay unclaimed for a later tick to retry.
      expect(fired).toBe(0)
      expect(claimSlaTimerTriggerMarker).not.toHaveBeenCalled()
      // The failure must actually reach workflow-sweep's own catch (not get
      // silently absorbed somewhere in the dispatch pipeline).
      expect(mockLogError).toHaveBeenCalledWith(
        expect.objectContaining({ err: outboxError }),
        'sla.approaching_breach dispatch failed; continuing the rest of the batch'
      )
    })

    it('does not claim the breach marker when the outbox write for sla.breached fails', async () => {
      await seedLiveTimerWorkflow('sla.breached')
      sweepSlaBreachTriggers.mockResolvedValue([breachedCandidate()])

      const fired = await sweepSlaTimerTriggers(new Date('2026-01-05T12:05:00Z'))

      expect(mockWriteEventToOutbox).toHaveBeenCalledTimes(1)
      expect(fired).toBe(0)
      expect(claimSlaTimerTriggerMarker).not.toHaveBeenCalled()
      expect(mockLogError).toHaveBeenCalledWith(
        expect.objectContaining({ err: outboxError }),
        'sla.breached dispatch failed; continuing the rest of the batch'
      )
    })
  }
)
