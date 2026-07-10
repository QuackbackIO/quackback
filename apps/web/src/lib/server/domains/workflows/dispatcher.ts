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
 * A workflow scoped to specific trigger channels is filtered out before the
 * (costlier) per-person frequency cap is checked. The event-bus handler
 * (Slice 5d-iii) constructs the trigger from a dispatched event and calls this.
 */
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { PrincipalType } from '@/lib/server/policy/types'
import { logger } from '@/lib/server/logger'
import { listLiveWorkflowsForTrigger } from './workflow.service'
import { resolveConditionContext } from './condition.context'
import { runWorkflow } from './workflow.engine'
import { channelAllows, frequencyCapAllows, hasActiveCustomerFacingRun } from './dispatcher.guards'

const log = logger.child({ component: 'workflow-dispatcher' })

export interface WorkflowTrigger {
  triggerType: string
  conversationId: ConversationId
  /** The triggering actor's type, reported truthfully; 'service' (automated)
   *  is gated out below unless the trigger opts out via allowServiceActor. */
  actorType: PrincipalType
  /** Exempts this trigger from the automated-actor gate. Only for a
   *  service-authored event that is a terminal, one-time signal (the AI
   *  assistant's hand-off) — never for an event a workflow action can itself
   *  produce, which would reopen the loop the gate exists to stop. */
  allowServiceActor?: boolean
  /** The person the run acts on, for per-person frequency caps. */
  subjectPrincipalId?: PrincipalId | null
  /** The triggering message (body + sender), if the trigger carried one. */
  message?: { body: string; senderType?: 'visitor' | 'agent' } | null
}

export interface DispatchWorkflowTriggerOpts {
  /**
   * The caller (dispatchWorkflowsForEvent) may already know whether a
   * customer-facing run is active on this conversation — it just resumed one
   * (still active) or just settled every waiting run via interruptWaitingRuns
   * (nothing left) earlier in the SAME dispatch cycle. Passing that answer
   * here skips this function's own hasActiveCustomerFacingRun SELECT, which
   * would otherwise just re-read what the caller already learned.
   *
   * Only ever a hint, never authoritative: the partial unique index on
   * workflow_runs is still the real exclusive lock (runWorkflow's insert
   * catches a 23505 the same way regardless of this hint), so a stale value
   * — a resumed run settling to terminal a moment later, or an interrupt call
   * that excluded one run — only costs an extra no-op insert attempt at
   * worst, never lets a second customer-facing run actually land. Omitted
   * (undefined) falls back to the original query, unchanged.
   */
  activeCustomerFacingRunHint?: boolean
}

export async function dispatchWorkflowTrigger(
  trigger: WorkflowTrigger,
  opts?: DispatchWorkflowTriggerOpts
): Promise<void> {
  // Human-caused only: an automated (service) actor never re-triggers workflows
  // unless the trigger's mapping explicitly vouched for it (allowServiceActor).
  if (trigger.actorType === 'service' && !trigger.allowServiceActor) return

  const live = await listLiveWorkflowsForTrigger(trigger.triggerType)
  if (live.length === 0) return

  const customerFacing = live.filter((w) => w.class === 'customer_facing')
  const background = live.filter((w) => w.class === 'background')

  // Resolve the snapshot once (every condition reads the same instant) and, only
  // when there are customer_facing workflows, probe the exclusive lock — both are
  // independent, so run them together. The hint (see DispatchWorkflowTriggerOpts)
  // skips the probe entirely when the caller already knows the answer.
  const [ctx, alreadyLocked] = await Promise.all([
    resolveConditionContext(trigger.conversationId, { message: trigger.message }),
    customerFacing.length === 0
      ? Promise.resolve(false)
      : opts?.activeCustomerFacingRunHint !== undefined
        ? Promise.resolve(opts.activeCustomerFacingRunHint)
        : hasActiveCustomerFacingRun(trigger.conversationId),
  ])
  if (!ctx) return

  const subject = trigger.subjectPrincipalId ?? null
  const start = (wf: (typeof live)[number]) =>
    runWorkflow(wf, ctx, { conversationId: trigger.conversationId, subjectPrincipalId: subject })

  // Customer-facing: exclusive. Skip entirely if one is already locked on this
  // conversation; otherwise the first that actually runs wins. A workflow the
  // channel guard rejects is never matched — the loop just moves on, so it
  // never consumes the exclusive first-match slot. frequencyCapAllows here is
  // only a cheap pre-check (skips an obviously-capped-out workflow before
  // paying for a transaction) — runWorkflow re-checks it authoritatively
  // under an advisory lock right before inserting the run, which is what
  // actually decides under concurrency.
  if (customerFacing.length > 0 && !alreadyLocked) {
    for (const wf of customerFacing) {
      if (!channelAllows(wf, ctx.conversation.channel)) continue
      if (!(await frequencyCapAllows(wf, subject))) continue
      const run = await start(wf)
      if (run) break // locked + ran; the rest are excluded for this conversation
    }
  }

  // Background: parallel, every cap-permitted workflow. Same pre-check-only
  // caveat as above — runWorkflow's transaction-scoped re-check is authoritative.
  //
  // Each workflow is isolated in its own try/catch: this call runs inside the
  // workflow-dispatch BullMQ job (see event-trigger.ts), so an uncaught
  // rejection here would fail the whole job and let BullMQ retry it. With
  // Promise.all over uncaught per-workflow promises, one workflow throwing
  // after siblings already committed their runs (e.g. a transient Redis error
  // scheduling a wait, thrown from deep inside runWorkflow) would reject the
  // batch and cause the retry to re-run those already-committed siblings —
  // there's no idempotency guard for that (the exclusive partial index only
  // covers customer_facing runs; frequency caps only cover capped workflows),
  // so a retry would duplicate their actions (tags, assignments, ...). Each
  // background workflow's run is therefore best-effort here, the same way its
  // individual actions already are inside applyPlanAndSettle: log and move on.
  await Promise.all(
    background.map(async (wf) => {
      try {
        if (!channelAllows(wf, ctx.conversation.channel)) return
        if (await frequencyCapAllows(wf, subject)) await start(wf)
      } catch (err) {
        log.error(
          { err, workflowId: wf.id, conversationId: trigger.conversationId },
          'background workflow run failed; continuing other background workflows'
        )
      }
    })
  )
}
