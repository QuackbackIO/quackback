/**
 * Workflow trigger resolver (EVENTING-V2 WO-8e). Fans workflow-exposed events to
 * the 'workflow' hook when the workspace has any live workflow. interestedIn is
 * catalogue-derived (exposure.workflow); resolve short-circuits via the cached
 * hasAnyLiveWorkflow() so an event never enqueues a workflow job for a workspace
 * with zero workflows. The hook applies the final per-event trigger gate.
 *
 * This replaces the special-cased fire-and-forget branch at the top of
 * processEvent (which is now gated to the legacy-flag path); the outbox makes
 * the trigger durable up to the workflow engine's own dispatch queue.
 */
import { logger } from '@/lib/server/logger'
import { getEventDefinition } from '../catalogue'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

const log = logger.child({ component: 'workflow-resolver' })

export const workflowTriggerResolver: SinkResolver = {
  sink: 'workflow',
  interestedIn(type: string): boolean {
    return getEventDefinition(type)?.exposure.workflow ?? false
  },
  async resolve(_event: DomainEvent): Promise<HookTarget[]> {
    try {
      const { hasAnyLiveWorkflow } = await import('@/lib/server/domains/workflows/workflow.service')
      if (!(await hasAnyLiveWorkflow())) return []
      return [{ type: 'workflow', target: {}, config: {} }]
    } catch (error) {
      log.error({ err: error }, 'failed to resolve workflow trigger target')
      return []
    }
  },
}
