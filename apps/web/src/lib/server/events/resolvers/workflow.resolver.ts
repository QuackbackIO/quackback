/**
 * Workflow trigger resolver (EVENTING-V2 WO-8e). Fans workflow-exposed events to
 * the 'workflow' hook when the workspace has any live workflow. interestedIn is
 * catalogue-derived (exposure.workflow); resolve short-circuits via the cached
 * hasAnyLiveWorkflow() so an event never enqueues a workflow job for a workspace
 * with zero workflows. The hook applies the final per-event trigger gate.
 *
 * This replaces the special-cased fire-and-forget branch that used to sit at
 * the top of processEvent (deleted in the WO-18 cutover); the outbox makes the
 * trigger durable up to the workflow engine's own dispatch queue.
 */
import { getEventDefinition } from '../catalogue'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

export const workflowTriggerResolver: SinkResolver = {
  sink: 'workflow',
  interestedIn(type: string): boolean {
    return getEventDefinition(type)?.exposure.workflow ?? false
  },
  async resolve(_event: DomainEvent): Promise<HookTarget[]> {
    const { hasAnyLiveWorkflow } = await import('@/lib/server/domains/workflows/workflow.service')
    if (!(await hasAnyLiveWorkflow())) return []
    return [{ type: 'workflow', target: {}, config: {} }]
  },
}
