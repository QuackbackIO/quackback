/**
 * Event bus -> workflow trigger bridge (support platform §4.6, Slice 5d-iii). Maps
 * a dispatched conversation/message event to a WorkflowTrigger and hands it to the
 * dispatcher. Non-conversation events (posts, comments, tickets, ...) map to null;
 * ticket-scoped triggers are a later extension.
 *
 * dispatchWorkflowsForEvent is invoked from the workflow-dispatch BullMQ job
 * (workflow-dispatch-queue.ts) rather than fire-and-forget straight off the
 * event pipeline, so it now lets errors propagate: a throw fails the job and
 * BullMQ retries it (3 attempts, exponential backoff) instead of the trigger
 * being silently dropped. The queue module's worker.on('failed') handler logs
 * a failure once retries are exhausted.
 *
 * This propagation is only safe for failures BEFORE any run starts —
 * interruptWaitingRuns itself, and inside dispatchWorkflowTrigger the workflow
 * listing / condition-context resolution that happens before either execution
 * class begins. Nothing has been written yet at that point, so a clean retry
 * just redoes the same read-only work. Once dispatchWorkflowTrigger starts
 * starting runs, retry-safety is two different properties per class:
 *
 *   - customer_facing (dispatcher.ts's exclusive for-loop) relies on the
 *     partial unique index on workflow_runs (one live run per conversation):
 *     if the winning run's own follow-up work throws (e.g. scheduling its
 *     wait timer) after the run row already committed as running/waiting, a
 *     retry's hasActiveCustomerFacingRun pre-check sees that row and skips
 *     re-starting it; a concurrent insert race is resolved the same way runWorkflow
 *     already documents (23505 caught, treated as never-matched).
 *   - background (dispatcher.ts's Promise.all map) has no such lock — caps
 *     only cover capped workflows — so each workflow's run is wrapped in its
 *     own try/catch instead: one workflow throwing (mid-run, after siblings
 *     already committed) is logged and does not fail the batch, so BullMQ
 *     never retries a background workflow that already ran.
 */
import type { EventData, MessageCreatedEvent } from '@/lib/server/events/types'
import type {
  ConversationId,
  PrincipalId,
  ConversationMessageId,
  WorkflowRunId,
} from '@quackback/ids'
import type { PrincipalType } from '@/lib/server/policy/types'
import type { BlockReplyMetadata, WorkflowRun } from '@/lib/server/db'
import type { BlockAnswer, AssistantOutcome } from './condition.evaluator'
import { dispatchWorkflowTrigger, type WorkflowTrigger } from './dispatcher'
import { interruptWaitingRuns, resumeWorkflowRun } from './workflow.engine'
import { findWaitingCustomerFacingRun, readMessageBlockReply } from './dispatcher.guards'
import { readCursor } from './workflow-wait-queue'

/** Map an event to a workflow trigger, or null when it isn't conversation-scoped.
 *  The event's trigger_type is its event type verbatim, so a workflow subscribes
 *  by the same name the bus dispatches. The switch below is the source of truth
 *  DISPATCHABLE_TRIGGER_TYPES (lib/shared/workflow-trigger-types.ts) mirrors for
 *  authoring validation — keep the two in sync by hand when a case is added. */
export function eventToWorkflowTrigger(event: EventData): WorkflowTrigger | null {
  // An automated (service) actor is carried through; the dispatcher gates it out.
  const actorType: PrincipalType = event.actor?.type === 'service' ? 'service' : 'user'

  switch (event.type) {
    case 'conversation.created': {
      const c = event.data.conversation
      return {
        triggerType: event.type,
        conversationId: c.id as ConversationId,
        actorType,
        subjectPrincipalId: (c.visitorPrincipalId ?? null) as PrincipalId | null,
        message: null,
      }
    }
    case 'conversation.status_changed':
    case 'conversation.assigned':
    case 'conversation.priority_changed':
    case 'conversation.csat_submitted': {
      return {
        triggerType: event.type,
        conversationId: event.data.conversation.id as ConversationId,
        actorType,
        subjectPrincipalId: null,
        message: null,
      }
    }
    case 'message.created':
    case 'message.note_created': {
      const m = event.data.message
      return {
        triggerType: event.type,
        conversationId: m.conversationId as ConversationId,
        actorType,
        // The customer is the frequency-cap subject; a teammate message has none.
        subjectPrincipalId: (m.senderType === 'visitor'
          ? m.authorPrincipalId
          : null) as PrincipalId | null,
        message: { body: m.content, senderType: m.senderType },
      }
    }
    case 'assistant.handed_off': {
      // The assistant's own service principal authors this event, so the
      // dispatcher's automated-actor gate would silently swallow it. That gate
      // exists to stop a workflow's own automated action from re-triggering
      // workflows; a terminal "the assistant gave up, hand off to a human"
      // signal is not that loop (no workflow action can produce it), so the
      // trigger opts out explicitly — actorType stays truthful for any other
      // consumer.
      return {
        triggerType: event.type,
        conversationId: event.data.conversationId as ConversationId,
        actorType,
        allowServiceActor: true,
        subjectPrincipalId: null,
        message: null,
      }
    }
    default:
      return null
  }
}

/**
 * A reply (any HUMAN message — visitor or teammate) or a close ends pending
 * waits on the conversation. A service-authored message (Quinn's own replies,
 * and — Phase C, slice C-1 — a workflow's own send_block post) is explicitly
 * EXCLUDED: it must never count as "someone replied" for THIS purpose.
 *
 * Without this exclusion, a block's own send_block action would self-
 * interrupt the very run that just parked waiting for it: appendAssistantReply
 * fires a message.created event for the block message it just posted, that
 * event flows through this same dispatch path (asynchronously, via the
 * workflow-dispatch queue), and — before this fix — every message.created
 * unconditionally interrupted every waiting/running run on the conversation,
 * including the one whose OWN action produced the message. The pre-existing
 * (pre-Phase-C) action catalogue never posted a message, so this race was
 * unreachable before send_block existed.
 *
 * This mirrors the contract's amendment 2 exactly ("later assistant/run
 * messages do not supersede" a block) — the same principle, applied on the
 * server's interrupt side rather than the widget's derived supersede state.
 * One pre-existing case DOES change, deliberately: a timed wait created by
 * the same customer message that also engaged the assistant used to be
 * cancelled moments later by the assistant's own reply (so an idle-close
 * timer never survived on assistant-handled conversations). It now survives,
 * which is the intended reading: a timer measuring customer silence should
 * not reset on automated replies, only on human ones.
 */
function isInterruptingEvent(event: EventData): boolean {
  return (
    (event.type === 'message.created' && event.actor.type !== 'service') ||
    (event.type === 'conversation.status_changed' && event.data.newStatus === 'closed')
  )
}

/** Map a stored BlockReplyMetadata (the visitor message's own metadata.blockReply)
 *  to the BlockAnswer resumeWorkflowRun threads into the resume's
 *  ConditionContext — same shape minus the correlation key, which its caller
 *  (tryResumeInputWait) has already spent matching against the cursor. */
function toBlockAnswer(reply: BlockReplyMetadata): BlockAnswer {
  switch (reply.kind) {
    case 'buttons':
      return { kind: 'buttons', buttonKey: reply.buttonKey }
    case 'collect':
      return { kind: 'collect', value: reply.value }
    case 'collectReply':
      return { kind: 'collectReply', value: reply.value }
    case 'csat':
      return { kind: 'csat', rating: reply.rating, comment: reply.comment }
  }
}

/** The outcome of a resume attempt: `runId` is the run that MATCHED (found
 *  waiting, before the resume attempt), independent of whether the resume
 *  itself actually took effect — a caller that needs to exclude this run from
 *  a follow-up interruptWaitingRuns call always has an id to exclude, even
 *  when `resumed` is null (the atomic claim no-op'd, e.g. raced by something
 *  else). `resumed` is resumeWorkflowRun's own return value, threaded through
 *  so the caller can decide the activeCustomerFacingRunHint off the run's
 *  ACTUAL post-resume state rather than assuming "matched" means "still
 *  active" (see dispatchWorkflowsForEvent's isRunStillActive). */
interface ResumeAttempt {
  runId: WorkflowRunId
  resumed: WorkflowRun | null
}

/**
 * Phase C conversational block layer (slice C-1): on a VISITOR message.created
 * only, check whether a customer-facing run is parked at an input wait on this
 * conversation and whether the new message is its matching structured reply —
 * if so, resume the run instead of interrupting it (the exclusive lock means
 * at most one customer-facing run can ever be waiting on this conversation, so
 * there's nothing else to interrupt in that case). Returns the resume attempt,
 * or null when nothing matched.
 *
 * Two DB touches, the second gated by the first: one indexed lookup
 * (findWaitingCustomerFacingRun) covers every visitor message.created event,
 * cheap and unconditional; the narrower PK read of the new message's own
 * metadata (readMessageBlockReply) only runs when that lookup actually found
 * a parked input wait to match against — the overwhelming majority of visitor
 * messages (no waiting run on the conversation at all) never reach it.
 */
async function tryResumeInputWait(event: MessageCreatedEvent): Promise<ResumeAttempt | null> {
  const conversationId = event.data.message.conversationId as ConversationId
  const run = await findWaitingCustomerFacingRun(conversationId)
  if (!run) return null

  const cursor = readCursor(run)
  if (cursor.waitKind !== 'input' || !cursor.blockMessageId) return null

  const blockReply = await readMessageBlockReply(event.data.message.id as ConversationMessageId)
  if (!blockReply || blockReply.inReplyToMessageId !== cursor.blockMessageId) return null

  const resumed = await resumeWorkflowRun(run.id, { blockAnswer: toBlockAnswer(blockReply) })
  return { runId: run.id, resumed }
}

/**
 * Phase C conversational block layer (slice C-6): resume a conversation's
 * parked `let_assistant_answer` wait, if there is one, down the edge `outcome`
 * selects. Mirrors tryResumeInputWait's shape (same findWaitingCustomerFacingRun
 * lookup — an assistant-wait is always on a customer_facing run, since only
 * that class's runs are ever reachable to resume at all, see
 * workflow.schemas.ts's classRestrictedNodeIssue) but keys off
 * `cursor.waitKind === 'assistant'` instead of 'input', and there's no second
 * narrow read to gate (no block-correlation to match — the outcome alone
 * routes). Returns the resume attempt (for the caller to exclude from a
 * follow-up interruptWaitingRuns call, and to read the post-resume state off
 * of) or null when nothing was parked there.
 */
async function tryResumeAssistantWait(
  conversationId: ConversationId,
  outcome: AssistantOutcome
): Promise<ResumeAttempt | null> {
  const run = await findWaitingCustomerFacingRun(conversationId)
  if (!run) return null

  const cursor = readCursor(run)
  if (cursor.waitKind !== 'assistant') return null

  const resumed = await resumeWorkflowRun(run.id, { assistantOutcome: outcome })
  return { runId: run.id, resumed }
}

/** True only when a resumed run is still occupying the customer-facing slot
 *  (running mid-actions, or re-parked at a new wait) — the two states in
 *  which dispatchWorkflowTrigger's own exclusive-lock probe would find it.
 *  A run that resumed-and-finished (done/interrupted) or whose claim no-op'd
 *  (resumed is null — already claimed/settled by something else in the
 *  interim) is NOT still active: the hint must be omitted in that case so the
 *  same-event customer-facing dispatch falls back to actually checking,
 *  instead of trusting a stale "still active" signal and skipping workflows
 *  that should now be free to start. */
function isRunStillActive(resumed: WorkflowRun | null): boolean {
  // Loose null check (not `!== null`): resumeWorkflowRun's real return type is
  // WorkflowRun | null, but this stays defensive against an unconfigured test
  // double resolving undefined rather than crashing on `.state`.
  return resumed != null && (resumed.state === 'running' || resumed.state === 'waiting')
}

/**
 * Fire workflow triggers for a dispatched event. Called from inside the
 * workflow-dispatch queue's job processor, so errors are NOT swallowed here —
 * they propagate to fail the job and let BullMQ retry.
 *
 * A reply or close first interrupts any pending waits on the conversation —
 * done BEFORE the new dispatch, and both inside this same call (and therefore
 * the same job), so a wait-bearing run the customer already answered doesn't
 * fire, while the run this same event triggers is created afterwards and
 * never caught by its own event's interrupt. Two resume-instead-of-interrupt
 * exceptions, both Phase C:
 *
 *  - (slice C-1) a visitor message matching a parked input wait's block
 *    resumes that run instead of interrupting it — but a matched reply is
 *    still genuine customer activity, so it ALSO still interrupts every OTHER
 *    waiting run on the conversation (e.g. an idle auto-close timer measuring
 *    customer silence), via the same excludeRunId carve-out the close path
 *    uses, so it doesn't undo the resume it just did.
 *  - (slice C-6) `assistant.handed_off` resumes a parked let_assistant_answer
 *    wait down its escalated edge; a close resumes one down its default edge
 *    INSTEAD of interrupting it (Quinn resolved the conversation — the
 *    classic resolved-then-follow-up pattern) — but a close still interrupts
 *    every OTHER waiting run on the conversation exactly as before, via the
 *    excludeRunId carve-out (see interruptWaitingRuns's doc).
 *
 * Everything else (a non-matching reply, free-typed text, a teammate
 * message, a close with nothing parked at an assistant-wait) falls through to
 * the interrupt path unchanged — except that a VISITOR message never
 * interrupts a parked assistant-wait either way (excludeWaitKind: 'assistant'
 * below): a multi-turn conversation with Quinn is normal, so only a teammate
 * message or the two resume triggers above can ever end one. Either way,
 * other triggers for this same event still dispatch afterward.
 */
export async function dispatchWorkflowsForEvent(event: EventData): Promise<void> {
  const trigger = eventToWorkflowTrigger(event)
  if (!trigger) return

  const isVisitorMessage =
    event.type === 'message.created' && event.data.message.senderType === 'visitor'
  const inputResume = isVisitorMessage ? await tryResumeInputWait(event) : null

  const isClose = event.type === 'conversation.status_changed' && event.data.newStatus === 'closed'
  const assistantResume =
    !inputResume && (event.type === 'assistant.handed_off' || isClose)
      ? await tryResumeAssistantWait(trigger.conversationId, isClose ? 'resolved' : 'escalated')
      : null

  // Advisory hint for dispatchWorkflowTrigger's own active-customer-facing-run
  // probe (see DispatchWorkflowTriggerOpts): this same call already learned
  // the answer above, either by resuming a run (still active) or by settling
  // every waiting run via interruptWaitingRuns (nothing left) — passing it
  // along skips a second, redundant SELECT for the same fact in this one
  // dispatch cycle. Left undefined (unknown) when neither branch below ran,
  // OR when a resume was attempted but isRunStillActive says the run is no
  // longer occupying the slot (resumed-and-finished, or the claim no-op'd) —
  // in either case the hint is not advisory, it SKIPS the probe entirely, so
  // a wrong "still active" value would wrongly block a same-event
  // customer-facing workflow that should now be free to start.
  let activeCustomerFacingRunHint: boolean | undefined
  if (!inputResume && !assistantResume && isInterruptingEvent(event)) {
    await interruptWaitingRuns(trigger.conversationId, {
      excludeWaitKind: isVisitorMessage ? 'assistant' : undefined,
    })
    activeCustomerFacingRunHint = false
  } else if (assistantResume && isClose) {
    await interruptWaitingRuns(trigger.conversationId, { excludeRunId: assistantResume.runId })
    if (isRunStillActive(assistantResume.resumed)) activeCustomerFacingRunHint = true
  } else if (inputResume) {
    await interruptWaitingRuns(trigger.conversationId, { excludeRunId: inputResume.runId })
    if (isRunStillActive(inputResume.resumed)) activeCustomerFacingRunHint = true
  } else if (assistantResume) {
    if (isRunStillActive(assistantResume.resumed)) activeCustomerFacingRunHint = true
  }
  // Only pass opts when there's an actual hint to give — an event that hit
  // none of the branches above (e.g. assistant.handed_off with nothing
  // parked to resume) leaves dispatchWorkflowTrigger's own probe exactly as
  // it was before this hint existed.
  await (activeCustomerFacingRunHint === undefined
    ? dispatchWorkflowTrigger(trigger)
    : dispatchWorkflowTrigger(trigger, { activeCustomerFacingRunHint }))
}
