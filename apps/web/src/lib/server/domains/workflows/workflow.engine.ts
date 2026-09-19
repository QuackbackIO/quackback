/**
 * The workflow run engine (support platform §4.6, Slice 5d-i). runWorkflow takes
 * one workflow + a resolved condition snapshot, walks its graph, executes the
 * planned actions through the shared executor, and records the run + its timeline.
 * It is the single-workflow half of the dispatcher; the dispatcher (5d-ii) does
 * the human-actor gate, class split (customer_facing exclusive vs background
 * parallel), and frequency caps around it; durable-wait resume (5e) continues a
 * run from its cursor.
 *
 * Actions run under a service actor with admin authority — a workflow is
 * admin-configured automation acting on the workspace's behalf, mirroring the
 * full-API-key service principal. Each action is best-effort (a failure is logged
 * to the timeline and the run continues) so one bad action never strands a run.
 */
import {
  db,
  and,
  eq,
  ne,
  inArray,
  sql,
  workflowRuns,
  type Transaction,
  type Workflow,
  type WorkflowRun,
  type WorkflowRunState,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'
import { logger } from '@/lib/server/logger'
import { isUniqueViolation } from '@/lib/server/utils'
import { applyAction, type ResolvedBlockDeps } from './action.executor'
import { walkWorkflow, type WorkflowGraph, type WalkResult } from './graph'
import type { ConditionContext, BlockAnswer, AssistantOutcome } from './condition.evaluator'
import { customInactivityAllowed } from '@/lib/server/domains/conversation/conversation.inactivity-mode'
import { getWorkflow } from './workflow.service'
import { resolveConditionContext } from './condition.context'
import { resolveWorkflowVariables } from './workflow-variables'
import { logRunEvent } from './workflow-run-events'
import { AUTOMATION_PERMISSIONS } from './workflow-actor-permissions'
import { ensureAssistantPrincipal } from '@/lib/server/domains/assistant/assistant.principal'
import {
  scheduleWorkflowResume,
  readCursor,
  type WaitCursor,
  type InputWaitCursor,
  type WaitKind,
} from './workflow-wait-queue'
import { hasFrequencyCap, claimFrequencyCapSlot } from './dispatcher.guards'
import { getWorkflowAbandonedAutoCloseSettings } from '@/lib/server/domains/settings/settings.workflows'

const log = logger.child({ component: 'workflow-engine' })

/**
 * How long an assistant wait may keep being deferred past its own expiry while
 * the engagement it delegated to is still alive (workflow-sweep.ts decides;
 * this is only the ceiling it reads off the cursor).
 *
 * A day. Long enough that the slowest lifecycle default in the product, email
 * closure at 72 hours aside, can produce its own outcome, and short enough that
 * a conversation nobody ever came back to stops holding the customer-facing
 * exclusive slot. Stamped at park time so a change to this constant never
 * moves a wait that is already parked.
 */
const ASSISTANT_WAIT_CEILING_MS = 24 * 60 * 60 * 1000

function workflowActor(): Actor {
  return boundedServiceActor(AUTOMATION_PERMISSIONS)
}

/** The conversation's visitor, as an Actor — for the one action
 *  (`record_csat`) that must run as the customer, not the run's own service
 *  actor: `recordCsat` requires its caller to BE the conversation's visitor
 *  (amendment 1), and the emitted csat_submitted event needs a human actor so
 *  it can legitimately trigger other workflows. `principalType: 'anonymous'`
 *  is a safe default here (an identified visitor's real type doesn't change
 *  the ownership check either path relies on — see canViewConversation /
 *  recordCsat's own `actor.principalId !== conversation.visitorPrincipalId`
 *  check), only `toEventActor` cares that it isn't 'service'. */
function visitorActor(visitorPrincipalId: PrincipalId | null): Actor {
  return {
    principalId: visitorPrincipalId,
    role: null,
    principalType: 'anonymous',
    segmentIds: new Set(),
  }
}

/** Read a stored graph defensively: a malformed shape becomes an empty graph
 *  (no nodes) so the walk simply produces nothing rather than throwing. Takes
 *  the raw jsonb value directly (a workflow's live graph, or a run's pinned
 *  snapshot of one) rather than a Workflow, so the same defensive handling
 *  covers both call sites in this module. */
function readGraph(graph: unknown): WorkflowGraph {
  const g = graph as Partial<WorkflowGraph> | null
  return {
    nodes: Array.isArray(g?.nodes) ? g!.nodes : [],
    edges: Array.isArray(g?.edges) ? g!.edges : [],
  }
}

/** Re-select a run by id. Used after a guarded settle update affects zero rows
 *  (someone else already moved the run on) to return its current row instead
 *  of the stale one the caller started from. Null when the row itself is gone
 *  (the conversation's cascade delete can remove it mid-settle). */
async function currentRun(runId: WorkflowRun['id']): Promise<WorkflowRun | null> {
  const [row] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1)
  return row ?? null
}

/**
 * Guarded settle: apply `patch` to a run only while it is still 'running'.
 * Returns null when the update affects zero rows — a concurrent writer
 * (interruptWaitingRuns, another settle) moved the run first and must win over
 * this settle rather than get overwritten. Every transition out of 'running'
 * goes through here, including the sweeper's stale-run settle.
 */
export async function settleRunning(
  runId: WorkflowRun['id'],
  patch: { state: WorkflowRunState; endedAt?: Date; cursor?: Record<string, unknown> },
  exec: typeof db | Transaction = db
): Promise<WorkflowRun | null> {
  const [settled] = await exec
    .update(workflowRuns)
    .set(patch)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.state, 'running')))
    .returning()
  return settled ?? null
}

export interface RunWorkflowOptions {
  conversationId: ConversationId
  /** The person the run acts on, for per-person frequency caps. */
  subjectPrincipalId?: PrincipalId | null
}

/**
 * Run one workflow against a conversation. Walks the graph, runs the planned
 * actions, and records a workflow_run + timeline. Returns null when the walk
 * produces no actions and isn't waiting (an entry that matches nothing is a
 * silent no-op), OR when the customer_facing exclusive lock was lost, OR when
 * a frequency cap denied the run on its authoritative re-check (see below). On
 * a wait the run is left in state 'waiting' with the resume node in its
 * cursor; Slice 5e schedules the timer and resumes. The run also pins a copy
 * of the workflow's graph at insert time (see the `graph` field below), and a
 * resume later walks that snapshot rather than the workflow's live graph.
 *

 * customer_facing exclusive lock: the dispatcher's hasActiveCustomerFacingRun
 * is only a cheap pre-check, so two triggers can both pass it and race here —
 * the partial unique index on workflow_runs is the real lock, and losing that
 * race (a 23505) is treated the same as never having matched.
 *
 * Frequency cap: the dispatcher's frequencyCapAllows call is the same kind of
 * cheap pre-check (read-then-act), so two concurrent triggers for the same
 * (workflow, person) can both pass it before either's run is inserted,
 * over-running a 'once'/'once_per_days'/'n_total' cap. When the workflow has
 * a cap configured (hasFrequencyCap) and the trigger has a real subject to
 * key on, the run insert is preceded — inside the same transaction — by
 * dispatcher.guards.ts's claimFrequencyCapSlot: a pg_advisory_xact_lock keyed
 * on (workflowId, subjectPrincipalId) plus an authoritative re-check of the
 * cap. The lock serializes concurrent triggers for that exact pair
 * (session-reentrant, so it never self-deadlocks) and releases automatically
 * at commit or rollback. An uncapped workflow (the common case) skips the
 * lock entirely — nothing to race over, and paying a session-level lock on
 * every run would be pure overhead. The 'started' run event is logged inside
 * this same transaction (not after it, as before): a crash between the run
 * insert and the event insert used to leave a run the cap count couldn't
 * see, silently under-enforcing the cap.
 */
export async function runWorkflow(
  workflow: Workflow,
  ctx: ConditionContext,
  opts: RunWorkflowOptions
): Promise<WorkflowRun | null> {
  const graph = readGraph(workflow.graph)
  const plan = walkWorkflow(graph, ctx)
  if (plan.actions.length === 0 && plan.status !== 'waiting') {
    return null
  }

  const subjectPrincipalId = opts.subjectPrincipalId ?? null
  const gateOnFrequencyCap = subjectPrincipalId !== null && hasFrequencyCap(workflow)

  let run: WorkflowRun | null
  try {
    // In its own transaction (a savepoint if the caller is already in one) so a
    // lost race here rolls back just this insert, not a surrounding transaction
    // (a caught unique violation would otherwise abort an enclosing one).
    run = await db.transaction(async (tx) => {
      if (gateOnFrequencyCap && subjectPrincipalId) {
        if (!(await claimFrequencyCapSlot(tx, workflow, subjectPrincipalId))) return null
      }

      const [inserted] = await tx
        .insert(workflowRuns)
        .values({
          workflowId: workflow.id,
          conversationId: opts.conversationId,
          subjectPrincipalId,
          state: 'running',
          customerFacing: workflow.class === 'customer_facing',
          // Pin the run to the graph as it exists right now. A resume later
          // walks this snapshot, not whatever the workflow has become by then
          // (see resumeWorkflowRun); it is identical to the live graph at this
          // instant, so the initial walk above needed no change.
          graph: workflow.graph,
        })
        .returning()
      // Same transaction as the run insert (see doc comment above) — not a
      // separate call after commit.
      await logRunEvent(inserted.id, workflow.id, subjectPrincipalId, 'started', tx)
      return inserted
    })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    log.debug(
      { workflowId: workflow.id, conversationId: opts.conversationId },
      'customer_facing lock lost to a concurrent run, skipping'
    )
    return null
  }
  if (!run) return null // frequency cap denied on the authoritative re-check

  return applyPlanAndSettle(run, workflow, plan, opts.conversationId, subjectPrincipalId, ctx)
}

/**
 * Run the actions of a walk plan (best-effort) then settle the run: on a wait,
 * persist the resume cursor and, for a timer wait, schedule the durable timer;
 * else mark it done. Shared by a fresh run and a resumed one.
 *
 * Both settle paths are guarded on `state = 'running'`: interruptWaitingRuns can
 * flip a run to 'interrupted' while its actions are still executing (a reply or
 * close lands mid-run), and that must win over this settle rather than get
 * overwritten. When the guarded update affects zero rows, the run was
 * interrupted concurrently: skip the run event and, on the waiting path, skip
 * scheduling a timer for a run that is no longer parked, and return the run's
 * current row instead of the stale one this function started with.
 *
 * `ctx` (Phase C, slice C-1) is the same resolved snapshot the walk itself ran
 * against — passed through purely so a `record_csat` action can be applied as
 * the conversation's VISITOR (ctx.conversation.visitorPrincipalId) rather than
 * the run's own service actor (see visitorActor's doc); every other action is
 * unaffected.
 * Once a non-idempotent action starts, a later failure is caught here rather
 * than reaching resumeWorkflowRun's catch-all, which would revert the run to
 * its original waiting cursor and replay already-committed customer-visible
 * work. The run is interrupted with a `resume_failed_after_side_effects`
 * event instead. A failure before any such action still rethrows so the
 * existing retry contract remains available when it is safe.
 */
async function applyPlanAndSettle(
  run: WorkflowRun,
  workflow: Workflow,
  plan: WalkResult,
  conversationId: ConversationId,
  subjectPrincipalId: PrincipalId | null,
  ctx: ConditionContext
): Promise<WorkflowRun | null> {
  const actor = workflowActor()
  // Set only when a send_block action posts a message — the one block kind
  // that also parks (status 'waiting', waitKind 'input') stamps it onto the
  // InputWaitCursor below as the correlation key a customer's reply matches.
  let blockMessageId: string | null = null
  let assistantDeclined = false
  // Set by a `let_assistant_answer` action in durable mode: the turn has not
  // been launched, and this park transaction is what requests it.
  let assistantDelegation: { nodeId: string; instructions?: string } | null = null
  // Once a non-idempotent action starts, a later failure must interrupt the
  // run instead of reverting to its old cursor and replaying customer-visible
  // work. Set before execution because an action may commit and then throw.
  let sideEffectExecutedOnce = false

  // Per-plan resolution (SF8 perf fix), mirroring the resolve-once
  // ConditionContext pattern the walk itself already uses: a plan with N
  // chained send_block actions (message, then buttons, ...) previously paid
  // ~3N queries (ensureAssistantPrincipal + resolveWorkflowVariables's own
  // two reads, all re-run per action inside sendBlock). Resolved at most once
  // when the plan has a send_block to feed; a plan with none pays nothing
  // extra, same as before. A failure here
  // propagates uncaught, same policy as resolveConditionContext's own reads:
  // by the time a plan exists, this conversation is known to exist (the walk
  // itself already required it), so a failure resolving these is a genuine
  // error, not a normal "nothing to send".
  let deps: ResolvedBlockDeps | undefined
  async function ensureDeps(): Promise<ResolvedBlockDeps> {
    if (!deps) {
      const [variables, assistant] = await Promise.all([
        resolveWorkflowVariables(conversationId),
        ensureAssistantPrincipal(),
      ])
      deps = { variables, assistant }
    }
    return deps
  }

  try {
    const resolvedBlockDeps: ResolvedBlockDeps | undefined = plan.actions.some(
      (a) => a.type === 'send_block'
    )
      ? await ensureDeps()
      : undefined
    for (const action of plan.actions) {
      if (
        workflow.triggerType === 'conversation.customer_unresponsive' &&
        ((await currentRun(run.id))?.state !== 'running' ||
          !(await customInactivityAllowed(conversationId)))
      ) {
        return await settleRunning(run.id, { state: 'interrupted', endedAt: new Date() })
      }
      try {
        if (
          [
            'send_block',
            'add_note',
            'record_csat',
            'send_webhook',
            'let_assistant_answer',
          ].includes(action.type)
        ) {
          sideEffectExecutedOnce = true
        }
        const actionActor =
          action.type === 'record_csat'
            ? visitorActor((ctx.conversation.visitorPrincipalId ?? null) as PrincipalId | null)
            : actor
        const result = await applyAction(action, {
          conversationId,
          actor: actionActor,
          runId: run.id,
          workflowId: workflow.id,
          workflowName: workflow.name,
          subjectPrincipalId,
          resolvedBlockDeps,
        })
        if (result.blockMessageId) blockMessageId = result.blockMessageId
        if (result.assistantDeclined) assistantDeclined = true
        if (result.assistantDelegation) assistantDelegation = result.assistantDelegation
      } catch (err) {
        log.error({ err, action: action.type, workflowId: workflow.id }, 'workflow action failed')
        await logRunEvent(run.id, workflow.id, subjectPrincipalId, `action_failed:${action.type}`)
        if (sideEffectExecutedOnce) {
          await logRunEvent(
            run.id,
            workflow.id,
            subjectPrincipalId,
            'resume_failed_after_side_effects'
          )
          const interrupted = await settleRunning(run.id, {
            state: 'interrupted',
            endedAt: new Date(),
          })
          return interrupted ?? (await currentRun(run.id))
        }
      }
    }
  } catch (err) {
    if (!sideEffectExecutedOnce) throw err
    log.error(
      { err, workflowId: workflow.id, runId: run.id },
      'workflow resume failed after a side effect may have committed; stopping the run instead of risking a replay'
    )
    await logRunEvent(run.id, workflow.id, subjectPrincipalId, 'resume_failed_after_side_effects')
    const interrupted = await settleRunning(run.id, { state: 'interrupted', endedAt: new Date() })
    return interrupted ?? (await currentRun(run.id))
  }

  if (
    assistantDeclined &&
    plan.status === 'waiting' &&
    plan.waitKind === 'assistant' &&
    plan.resumeNodeId
  ) {
    const next = walkWorkflow(
      readGraph(workflow.graph),
      { ...ctx, assistantOutcome: 'escalated' },
      plan.resumeNodeId
    )
    return applyPlanAndSettle(run, workflow, next, conversationId, subjectPrincipalId, {
      ...ctx,
      assistantOutcome: 'escalated',
    })
  }

  if (plan.status === 'waiting' && (plan.waitKind === 'input' || plan.waitKind === 'assistant')) {
    // Interactive block / let_assistant_answer park: no BullMQ timer for
    // either — resumed by event-trigger.ts on a matching structured reply
    // ('input') or Quinn's own hand-off/close signal ('assistant'), never a
    // clock (see workflow-wait-queue.ts's WaitCursor doc for why the orphan
    // sweeper must never touch either of these). Only 'input' carries the
    // extra block-correlation fields; 'assistant' has nothing else to
    // stamp beyond the node to resume at.
    const waitSeq = (readCursor(run).waitSeq ?? 0) + 1
    // Abandoned-journey auto-close (rides the sweeper's expiry pass,
    // workflow-sweep.ts): an 'input' park is abandoned by the customer, and
    // the configured wait minutes decide when. An 'assistant' park is not
    // about customer silence at all, so it carries its own default deadline
    // instead: the moment the sweeper should ask whether this delegation is
    // still alive (see sweepExpiredAssistantWaits, which defers while it is).
    const expiresAt = await (async () => {
      const autoClose = await getWorkflowAbandonedAutoCloseSettings()
      if (!autoClose.enabled) {
        // Assistant waits always get a default expiry so a declined/silent
        // Quinn cannot hold the exclusive lock forever.
        if (plan.waitKind === 'assistant') {
          return new Date(Date.now() + 10 * 60_000).toISOString()
        }
        return null
      }
      return new Date(Date.now() + autoClose.waitMinutes * 60_000).toISOString()
    })()
    if (plan.waitKind === 'input') {
      const cursor: InputWaitCursor = {
        waitKind: 'input',
        resumeNodeId: plan.resumeNodeId!,
        blockMessageId: blockMessageId ?? '',
        blockKind: plan.blockKind!,
        allowTypingInterrupt: plan.allowTypingInterrupt ?? false,
        expiresAt,
        waitSeconds: 0,
        waitSeq,
        waitStartedAt: new Date().toISOString(),
      }
      const waiting = await settleRunning(run.id, {
        state: 'waiting',
        cursor: cursor as unknown as Record<string, unknown>,
      })
      if (!waiting) return currentRun(run.id)
      await logRunEvent(run.id, workflow.id, subjectPrincipalId, 'waiting')
      return waiting
    }

    // The assistant park and the Quinn turn that answers it commit together
    // (P4). Ordering is the whole point: a turn requested before the park
    // could hand off while this run was still 'running', and that completion
    // would find no wait to resume. Requesting it here means the job becomes
    // claimable only once the wait it answers is durable.
    //
    // The trigger key (workflow run, node, visit) is the per-step receipt:
    // replaying this park — a retried wait job, a re-walked resume — resolves
    // to the same run instead of delegating a second time.
    try {
      return await parkAtAssistantWait({
        run,
        workflow,
        conversationId,
        subjectPrincipalId,
        resumeNodeId: plan.resumeNodeId!,
        waitSeq,
        expiresAt,
        delegation: assistantDelegation,
      })
    } catch (err) {
      // The park did not commit, so there is no wait and no delegated run:
      // both halves rolled back together. Interrupting is the documented
      // atomic result. Retrying the walk would re-run the actions that
      // already committed before this park, and holding the run 'running'
      // would keep the customer-facing slot until the stale sweep.
      log.error(
        { err, workflowId: workflow.id, runId: run.id },
        'assistant delegation could not be parked; interrupting the run'
      )
      await logRunEvent(run.id, workflow.id, subjectPrincipalId, 'delegation_park_failed')
      const interrupted = await settleRunning(run.id, {
        state: 'interrupted',
        endedAt: new Date(),
      })
      return interrupted ?? (await currentRun(run.id))
    }
  }

  if (plan.status === 'waiting') {
    const waitSeconds = plan.waitSeconds ?? 0
    // Increments on every park in this run (starting from 0) so each wait gets
    // its own durable-timer job id instead of colliding with an earlier one.
    const waitSeq = (readCursor(run).waitSeq ?? 0) + 1
    const cursor: WaitCursor = {
      waitKind: 'timer',
      resumeNodeId: plan.resumeNodeId ?? null,
      waitSeconds,
      waitSeq,
      waitStartedAt: new Date().toISOString(),
    }
    const waiting = await settleRunning(run.id, {
      state: 'waiting',
      cursor: cursor as unknown as Record<string, unknown>,
    })
    if (!waiting) return currentRun(run.id)
    await logRunEvent(run.id, workflow.id, subjectPrincipalId, 'waiting')
    await scheduleWorkflowResume(run.id, waitSeconds, waitSeq)
    return waiting
  }

  const done = await settleRunning(run.id, { state: 'done', endedAt: new Date() })
  if (!done) return currentRun(run.id)
  await logRunEvent(run.id, workflow.id, subjectPrincipalId, 'completed')
  return done
}

/**
 * Park at a `let_assistant_answer` wait and request the turn that answers it,
 * in one transaction (P4).
 *
 * Ordering is the whole point. A turn requested before the park could hand off
 * while this run was still 'running', and that completion would find no wait to
 * resume; requesting it here means the job becomes claimable only once the wait
 * it answers is durable. The delegation identity it carries (workflow run,
 * node, visit) is also the per-step receipt: replaying this park, after a
 * retried wait job or a re-walked resume, resolves to the same run through the
 * unique trigger key instead of delegating a second time.
 *
 * `delegation` is null under the legacy execution selector, where the executor
 * launched the turn out of band. The park still happens, and the wait still
 * ends the way it did before P4, through the completion events.
 */
async function parkAtAssistantWait(input: {
  run: WorkflowRun
  workflow: Workflow
  conversationId: ConversationId
  subjectPrincipalId: PrincipalId | null
  resumeNodeId: string
  waitSeq: number
  expiresAt: string | null
  delegation: { nodeId: string; instructions?: string } | null
}): Promise<WorkflowRun | null> {
  const { run, workflow, conversationId, subjectPrincipalId, waitSeq } = input
  return db.transaction(async (tx) => {
    const parkedAt = new Date()
    const cursor: WaitCursor = {
      waitKind: 'assistant',
      resumeNodeId: input.resumeNodeId,
      waitSeconds: 0,
      waitSeq,
      waitStartedAt: parkedAt.toISOString(),
      expiresAt: input.expiresAt,
      expiryCeilingAt: new Date(parkedAt.getTime() + ASSISTANT_WAIT_CEILING_MS).toISOString(),
      delegatedRunId: null,
    }
    let waiting = await settleRunning(
      run.id,
      { state: 'waiting', cursor: cursor as unknown as Record<string, unknown> },
      tx
    )
    if (!waiting) return currentRun(run.id)

    if (input.delegation) {
      const { requestAssistantTurn, workflowDelegationTriggerKey } =
        await import('@/lib/server/domains/assistant/assistant-run.service')
      const delegation = {
        workflowRunId: run.id as string,
        nodeId: input.delegation.nodeId,
        waitSeq,
      }
      const requested = await requestAssistantTurn(tx, {
        conversationId,
        triggerKey: workflowDelegationTriggerKey(
          delegation.workflowRunId,
          delegation.nodeId,
          delegation.waitSeq
        ),
        triggerKind: 'workflow_delegation',
        surface: 'workflow_step',
        delegation,
        stepInstructions: input.delegation.instructions ?? null,
      })
      const [stamped] = await tx
        .update(workflowRuns)
        .set({ cursor: { ...cursor, delegatedRunId: requested.run.id } })
        .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.state, 'waiting')))
        .returning()
      if (stamped) waiting = stamped
    }

    await logRunEvent(run.id, workflow.id, subjectPrincipalId, 'waiting', tx)
    return waiting
  })
}

/** Settle a claimed run straight to a terminal state with no further actions
 *  (the vanished-workflow/paused-workflow/missing-cursor paths in
 *  resumeWorkflowRun). Guarded the same way as applyPlanAndSettle: a concurrent
 *  interrupt wins, and this returns the run's current row either way. */
async function settleTerminal(
  run: WorkflowRun,
  state: 'done' | 'interrupted'
): Promise<WorkflowRun | null> {
  const settled = await settleRunning(run.id, { state, endedAt: new Date() })
  return settled ?? (await currentRun(run.id))
}

/**
 * Resume a waiting run when its timer fires (called by the wait worker). Claims
 * the run first with an atomic waiting -> running update: a run already claimed
 * by another attempt, interrupted by a reply/close, or already handled affects
 * zero rows there and resumes nothing. The claim also stamps `resumedAt` into
 * the cursor in the same update — the sweeper measures a resumed run's
 * staleness from it, and a timer can fire far later than its scheduled time
 * (queue backlog, worker downtime), so the wait's fire time alone under-reports
 * how recently the run actually became live.
 *
 * Only a successful claim goes on to load the workflow, condition context, and
 * resume node. The workflow row is loaded purely to gate on its current
 * status; the walk itself uses the run's own `graph` snapshot (stamped at
 * insert time by runWorkflow), never the workflow's live graph. Editing the
 * workflow, or deleting the resume node, while a run sits parked at a wait
 * must not change what a resumed run does: without the snapshot, a resume
 * would walk arbitrary new logic, or silently settle the run 'done' if the
 * resume node no longer exists. A paused (or otherwise non-live) workflow
 * does not act post-wait (pausing only stops new dispatches, not runs already
 * parked), except that a run parked at a successor-less wait had nothing
 * left to run and settles 'done' regardless of status. The original
 * triggering message is not available post-wait, so a post-wait message
 * condition sees none.
 *
 * Any throw after the claim reverts it (guarded, so a concurrent interrupt
 * still wins) and rethrows: without the revert, the retry's claim would match
 * zero rows (state is already 'running') and silently no-op, stranding the run
 * until the sweeper interrupts it — losing its post-wait actions. This same
 * atomic claim is what makes a blockAnswer resume retry-safe (Phase C, slice
 * C-1): a BullMQ-style retry, or event-trigger.ts racing a second matching
 * reply, both see the run already 'running' and no-op here exactly like a
 * timer-wait retry does.
 *
 * `opts.blockAnswer` (Phase C, slice C-1): threaded into the resume's
 * ConditionContext ONLY — never persisted — so the walker resuming an
 * interactive block node (graph.ts) can route/write the customer's answer.
 * `opts.assistantOutcome` (Phase C, slice C-6) is the same idea for a
 * `let_assistant_answer` park: threaded into the ConditionContext ONLY so the
 * walker can pick the escalated-vs-default edge. Only event-trigger.ts's
 * resume-vs-interrupt checks ever pass either; a timer-fired resume (the wait
 * worker) calls this with no opts, exactly as before.
 */
export async function resumeWorkflowRun(
  runId: WorkflowRun['id'],
  opts?: {
    blockAnswer?: BlockAnswer
    assistantOutcome?: AssistantOutcome
    expectedWaitSeq?: number
    /**
     * Take Quinn's authority away in the SAME transaction as this claim, with
     * the reason recorded on whatever it fences (P4). The expiry sweep passes
     * it: the escalated edge routes the customer to a human, so a Quinn turn
     * that was generating when the wait expired must not be able to publish
     * afterwards. Any other resume leaves Quinn alone.
     */
    fenceAssistantWork?: string
  }
): Promise<WorkflowRun | null> {
  const claimFilters = [eq(workflowRuns.id, runId), eq(workflowRuns.state, 'waiting')]
  if (opts?.expectedWaitSeq !== undefined) {
    claimFilters.push(sql`(${workflowRuns.cursor}->>'waitSeq')::int = ${opts.expectedWaitSeq}`)
  }
  const claimPatch = {
    state: 'running' as const,
    cursor: sql`coalesce(${workflowRuns.cursor}, '{}'::jsonb) || jsonb_build_object('resumedAt', ${new Date().toISOString()}::text)`,
  }
  const fenceReason = opts?.fenceAssistantWork
  const claimed = fenceReason
    ? await db.transaction(async (tx) => {
        const [row] = await tx
          .update(workflowRuns)
          .set(claimPatch)
          .where(and(...claimFilters))
          .returning()
        if (row?.conversationId) {
          const { invalidateAssistantWork } =
            await import('@/lib/server/domains/assistant/assistant-run.service')
          await invalidateAssistantWork(tx, row.conversationId, fenceReason)
        }
        return row ?? null
      })
    : ((
        await db
          .update(workflowRuns)
          .set(claimPatch)
          .where(and(...claimFilters))
          .returning()
      )[0] ?? null)
  if (!claimed) return null // already claimed / interrupted / handled

  try {
    const resumeNodeId = readCursor(claimed).resumeNodeId ?? null
    if (!resumeNodeId) {
      // The wait had no successor: the run finished at the wait.
      return await settleTerminal(claimed, 'done')
    }

    const workflow = claimed.conversationId ? await getWorkflow(claimed.workflowId) : null
    if (workflow && workflow.status !== 'live') {
      return await settleTerminal(claimed, 'interrupted')
    }

    const ctx = claimed.conversationId
      ? await resolveConditionContext(claimed.conversationId, {
          blockAnswer: opts?.blockAnswer,
          assistantOutcome: opts?.assistantOutcome,
        })
      : null
    if (!workflow || !claimed.conversationId || !ctx) {
      // The workflow or conversation vanished while parked — settle it.
      return await settleTerminal(claimed, 'interrupted')
    }

    // The pinned snapshot, not workflow.graph: the workflow row above is only
    // consulted for its status (live/paused/gone), never re-walked. Editing
    // the workflow, or deleting the resume node, while this run sat parked
    // must not change what it does on resume.
    const graph = readGraph(claimed.graph)
    const plan = walkWorkflow(graph, ctx, resumeNodeId)
    return await applyPlanAndSettle(
      claimed,
      workflow,
      plan,
      claimed.conversationId,
      claimed.subjectPrincipalId,
      ctx
    )
  } catch (err) {
    await db
      .update(workflowRuns)
      .set({ state: 'waiting' })
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.state, 'running')))
    throw err
  }
}

/**
 * End every waiting run on a conversation (a reply or close interrupts pending
 * waits, per §4.6). Returns how many were interrupted. Wired into the reply/close
 * paths as a follow-up; the wait worker also re-checks state, so a late timer on
 * an interrupted run is already a no-op.
 *
 * Cursor-aware (Phase C, slice C-6) via two independent, narrowly-scoped
 * carve-outs — this stays a blunt "everything on the conversation" UPDATE by
 * default, since a reply or close interrupting every OTHER pending wait is
 * still exactly the right behavior:
 *
 *  - `excludeWaitKind` — event-trigger.ts passes `'assistant'` ONLY on a
 *    VISITOR message.created: a multi-turn conversation with Quinn is normal,
 *    so a visitor's message must never end a parked let_assistant_answer
 *    wait. A teammate message passes no exclusion (a human taking over ends
 *    the assistant's turn same as everything else); neither does a close (see
 *    the next bullet — a parked assistant-wait resumes on close instead).
 *    Typed as the full `WaitKind` union (matching the sweeper's own
 *    future-proof style, see workflow-sweep.ts's isTimerWait) rather than the
 *    single literal any call site happens to pass today, so a future wait
 *    kind is excludable here without widening this signature again.
 *  - `excludeRunId` — event-trigger.ts passes the specific run id it just
 *    resumed (via tryResumeAssistantWait on a close event, or tryResumeInputWait
 *    on a matched structured reply) so THIS interrupt call — which still
 *    needs to end every OTHER waiting run on the conversation, exactly as
 *    before — doesn't also undo that resume, whether the resumed run already
 *    settled or re-parked at a new wait in the same call.
 */
export async function interruptWaitingRuns(
  conversationId: ConversationId,
  opts?: { excludeRunId?: WorkflowRun['id']; excludeWaitKind?: WaitKind }
): Promise<number> {
  const filters = [
    eq(workflowRuns.conversationId, conversationId),
    inArray(workflowRuns.state, ['running', 'waiting']),
  ]
  if (opts?.excludeRunId) filters.push(ne(workflowRuns.id, opts.excludeRunId))
  if (opts?.excludeWaitKind) {
    filters.push(
      sql`coalesce(${workflowRuns.cursor}->>'waitKind', 'timer') <> ${opts.excludeWaitKind}`
    )
  }
  const interrupted = await db
    .update(workflowRuns)
    .set({ state: 'interrupted', endedAt: new Date() })
    .where(and(...filters))
    .returning({ id: workflowRuns.id })
  return interrupted.length
}
