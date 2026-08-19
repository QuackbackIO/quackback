/**
 * Workflow trigger hook (EVENTING-V2 WO-8e).
 *
 * Under eventing-v2, workflow triggers ride the durable outbox: the relay fans a
 * workflow-exposed event to this hook, which applies the same two cheap gates
 * the legacy top-of-processEvent branch used (eventToWorkflowTrigger, then
 * hasAnyLiveWorkflow) and enqueues the workflow dispatch. The win over the old
 * fire-and-forget branch is durability: the trigger is now committed to the
 * outbox before this runs, so a crash in the window can't silently drop it.
 *
 * The workflow engine keeps its own dispatch queue + run state machine
 * downstream; this hook only bridges the event bus into it (WO-18 may collapse
 * the bridge further once the legacy branch is gone).
 */
import type { HookHandler, HookResult } from '../hook-types'
import type { EventData } from '../types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'workflow-hook' })

export const workflowHook: HookHandler = {
  async run(event: EventData): Promise<HookResult> {
    try {
      const { eventToWorkflowTrigger } =
        await import('@/lib/server/domains/workflows/event-trigger')
      if (!eventToWorkflowTrigger(event)) return { success: true }

      const { hasAnyLiveWorkflow } = await import('@/lib/server/domains/workflows/workflow.service')
      if (!(await hasAnyLiveWorkflow())) return { success: true }

      const { enqueueWorkflowDispatch } =
        await import('@/lib/server/domains/workflows/workflow-dispatch-queue')
      await enqueueWorkflowDispatch(event)
      return { success: true }
    } catch (error) {
      log.error({ err: error, event_type: event.type }, 'workflow trigger dispatch failed')
      // Retryable: the outbox/BullMQ will retry, and enqueueWorkflowDispatch is
      // idempotent on the event id.
      return {
        success: false,
        error: error instanceof Error ? error.message : 'workflow dispatch failed',
        shouldRetry: true,
      }
    }
  },
}
