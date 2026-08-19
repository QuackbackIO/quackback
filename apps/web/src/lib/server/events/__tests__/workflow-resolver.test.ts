import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  eventToWorkflowTrigger: vi.fn(),
  hasAnyLiveWorkflow: vi.fn(),
  enqueueWorkflowDispatch: vi.fn(),
}))
vi.mock('@/lib/server/domains/workflows/event-trigger', () => ({
  eventToWorkflowTrigger: h.eventToWorkflowTrigger,
}))
vi.mock('@/lib/server/domains/workflows/workflow.service', () => ({
  hasAnyLiveWorkflow: h.hasAnyLiveWorkflow,
}))
vi.mock('@/lib/server/domains/workflows/workflow-dispatch-queue', () => ({
  enqueueWorkflowDispatch: h.enqueueWorkflowDispatch,
}))

import { createId } from '@quackback/ids'
import { workflowTriggerResolver } from '../resolvers/workflow.resolver'
import { workflowHook } from '../handlers/workflow'
import type { DomainEvent } from '../envelope'
import type { EventData } from '../types'

function evt(type: string): DomainEvent {
  return {
    eventId: createId('event'),
    seq: 1n,
    type,
    entityType: 'conversation',
    entityId: createId('conversation'),
    actorType: 'user',
    payload: {},
    context: { depth: 0 },
    schemaVersion: 1,
    occurredAt: new Date(),
  }
}
const legacy = { id: createId('event'), type: 'conversation.created' } as unknown as EventData

describe('workflow trigger resolver + hook (WO-8e)', () => {
  beforeEach(() => Object.values(h).forEach((fn) => fn.mockReset()))

  it('interestedIn is catalogue-derived (exposure.workflow)', () => {
    expect(workflowTriggerResolver.interestedIn('conversation.created')).toBe(true)
    expect(workflowTriggerResolver.interestedIn('ticket.status_changed')).toBe(true)
    // not workflow-exposed
    expect(workflowTriggerResolver.interestedIn('post.created')).toBe(false)
    expect(workflowTriggerResolver.interestedIn('changelog.published')).toBe(false)
  })

  it('yields a workflow target only when a live workflow exists', async () => {
    h.hasAnyLiveWorkflow.mockResolvedValue(true)
    expect(await workflowTriggerResolver.resolve(evt('conversation.created'))).toEqual([
      { type: 'workflow', target: {}, config: {} },
    ])
    h.hasAnyLiveWorkflow.mockResolvedValue(false)
    expect(await workflowTriggerResolver.resolve(evt('conversation.created'))).toEqual([])
  })

  it('hook enqueues dispatch when the event maps to a trigger + a live workflow exists', async () => {
    h.eventToWorkflowTrigger.mockReturnValue({ triggerType: 'conversation.created' })
    h.hasAnyLiveWorkflow.mockResolvedValue(true)
    const res = await workflowHook.run(legacy, {}, {})
    expect(res.success).toBe(true)
    expect(h.enqueueWorkflowDispatch).toHaveBeenCalledWith(legacy)
  })

  it('hook no-ops (no enqueue) when the event maps to no trigger', async () => {
    h.eventToWorkflowTrigger.mockReturnValue(null)
    const res = await workflowHook.run(legacy, {}, {})
    expect(res.success).toBe(true)
    expect(h.enqueueWorkflowDispatch).not.toHaveBeenCalled()
  })

  it('hook asks to retry on dispatch failure', async () => {
    h.eventToWorkflowTrigger.mockReturnValue({ triggerType: 'x' })
    h.hasAnyLiveWorkflow.mockResolvedValue(true)
    h.enqueueWorkflowDispatch.mockRejectedValue(new Error('redis down'))
    const res = await workflowHook.run(legacy, {}, {})
    expect(res).toMatchObject({ success: false, shouldRetry: true })
  })
})
