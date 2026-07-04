/**
 * The workflow dispatcher (support platform §4.6, Slice 5d-ii). One entry point,
 * dispatchWorkflowTrigger, turns a trigger into runs: it gates on a human actor
 * (automated actors never re-trigger workflows — the single most important guard
 * against loops), loads the live workflows for the trigger, resolves the condition
 * snapshot once, then applies the two execution classes:
 *
 *   - customer_facing = EXCLUSIVE per conversation: evaluated in drag order, the
 *     first that actually runs locks the conversation and the rest are skipped;
 *     if a run is already live on the conversation, none start.
 *   - background = PARALLEL: every cap-permitted workflow runs independently.
 *
 * Per-person frequency caps are checked before each run. The event-bus handler
 * (Slice 5d-iii) constructs the trigger from a dispatched event and calls this.
 */
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { PrincipalType } from '@/lib/server/policy/types'
import { listLiveWorkflowsForTrigger } from './workflow.service'
import { resolveConditionContext } from './condition.context'
import { runWorkflow } from './workflow.engine'
import { frequencyCapAllows, hasActiveCustomerFacingRun } from './dispatcher.guards'

export interface WorkflowTrigger {
  triggerType: string
  conversationId: ConversationId
  /** The triggering actor's type; 'service' (automated) is gated out. */
  actorType: PrincipalType
  /** The person the run acts on, for per-person frequency caps. */
  subjectPrincipalId?: PrincipalId | null
  /** The triggering message (body + sender), if the trigger carried one. */
  message?: { body: string; senderType?: 'visitor' | 'agent' } | null
}

export async function dispatchWorkflowTrigger(trigger: WorkflowTrigger): Promise<void> {
  // Human-caused only: an automated (service) actor never re-triggers workflows.
  if (trigger.actorType === 'service') return

  const live = await listLiveWorkflowsForTrigger(trigger.triggerType)
  if (live.length === 0) return

  const customerFacing = live.filter((w) => w.class === 'customer_facing')
  const background = live.filter((w) => w.class === 'background')

  // Resolve the snapshot once (every condition reads the same instant) and, only
  // when there are customer_facing workflows, probe the exclusive lock — both are
  // independent, so run them together.
  const [ctx, alreadyLocked] = await Promise.all([
    resolveConditionContext(trigger.conversationId, { message: trigger.message }),
    customerFacing.length > 0
      ? hasActiveCustomerFacingRun(trigger.conversationId)
      : Promise.resolve(false),
  ])
  if (!ctx) return

  const subject = trigger.subjectPrincipalId ?? null
  const start = (wf: (typeof live)[number]) =>
    runWorkflow(wf, ctx, { conversationId: trigger.conversationId, subjectPrincipalId: subject })

  // Customer-facing: exclusive. Skip entirely if one is already locked on this
  // conversation; otherwise the first that actually runs wins.
  if (customerFacing.length > 0 && !alreadyLocked) {
    for (const wf of customerFacing) {
      if (!(await frequencyCapAllows(wf, subject))) continue
      const run = await start(wf)
      if (run) break // locked + ran; the rest are excluded for this conversation
    }
  }

  // Background: parallel, every cap-permitted workflow.
  await Promise.all(
    background.map(async (wf) => {
      if (await frequencyCapAllows(wf, subject)) await start(wf)
    })
  )
}
