/**
 * Event bus -> workflow trigger bridge (support platform §4.6, Slice 5d-iii). Maps
 * a dispatched conversation/message event to a WorkflowTrigger and hands it to the
 * dispatcher. Non-conversation events (posts, comments, ...) map to null.
 *
 * Ticket triggers (ticket.created / ticket.status_changed) are conversation-linked
 * tickets ONLY — a ticket event's own payload never carries a conversationId (see
 * ticket.webhooks.ts's EventTicketRef/EventTicketData), and the dispatcher is
 * conversation-keyed (WorkflowTrigger.conversationId is required), so these two
 * event types need an extra async step: dispatchWorkflowsForEvent's own ticket
 * branch below resolves the ticket's linked CUSTOMER conversation (one indexed
 * lookup — ticket_conversations' real primary key leads with ticket_id) BEFORE
 * calling eventToWorkflowTrigger, and passes the answer as `resolvedConversationId`.
 * No linked conversation -> the event maps to null (no dispatch). Since
 * eventToWorkflowTrigger itself stays synchronous (events/process.ts's own cheap
 * pre-filter calls it with no resolution info, purely to ask "could this event
 * type ever become a trigger" before enqueuing onto the durable dispatch queue —
 * see the ticket cases below for how that caller is kept working).
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
  TicketId,
  WorkflowId,
  WorkflowRunId,
} from '@quackback/ids'
import type { PrincipalType } from '@/lib/server/policy/types'
import type { BlockReplyMetadata, WorkflowRun } from '@/lib/server/db'
import { db, eq, and, ticketConversations } from '@/lib/server/db'
import type { TicketStatusCategory } from '@/lib/shared/db-types'
import type { BlockAnswer, AssistantOutcome } from './condition.evaluator'
import { dispatchWorkflowTrigger, type WorkflowTrigger } from './dispatcher'
import { interruptWaitingRuns, resumeWorkflowRun, logRunEvent } from './workflow.engine'
import { findWaitingCustomerFacingRun, readMessageBlockReply } from './dispatcher.guards'
import { readCursor } from './workflow-wait-queue'

/**
 * Placeholder conversationId returned ONLY when eventToWorkflowTrigger is
 * called for a ticket event with no resolution info at all (see the module
 * doc). The two callers that ever hit this branch — events/process.ts's
 * coarse pre-filter and this file's own DISPATCHABLE_TRIGGER_TYPES sync test
 * — only ever check the return value for truthiness/nullness, never read
 * this field, so a fake id here is safe: were it ever accidentally threaded
 * through to a real dispatch, resolveConditionContext would simply fail to
 * find a matching conversation and fail closed, rather than acting on the
 * wrong one.
 */
const UNRESOLVED_TICKET_CONVERSATION_ID = '' as ConversationId

/**
 * The linked CUSTOMER ticket's conversation id for `ticketId`, or null when
 * it has none. One indexed lookup: ticket_conversations' real primary key
 * leads with ticket_id (see the schema's own doc), so filtering by ticketId
 * is a straight PK read, not a scan.
 */
async function resolveTicketConversationId(ticketId: string): Promise<ConversationId | null> {
  const [row] = await db
    .select({ conversationId: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.ticketId, ticketId as TicketId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  return (row?.conversationId as ConversationId | undefined) ?? null
}

/** Map an event to a workflow trigger, or null when it isn't conversation-scoped.
 *  The event's trigger_type is its event type verbatim, so a workflow subscribes
 *  by the same name the bus dispatches. The switch below is the source of truth
 *  DISPATCHABLE_TRIGGER_TYPES (lib/shared/workflow-trigger-types.ts) mirrors for
 *  authoring validation — keep the two in sync by hand when a case is added. */
export function eventToWorkflowTrigger(
  event: EventData,
  /** Ticket events only: the ticket's linked customer conversation, resolved
   *  ASYNCHRONOUSLY by dispatchWorkflowsForEvent's own ticket branch before
   *  calling this (otherwise synchronous) function — see the module doc.
   *  `null` = resolved, definitely no linked conversation (maps to null
   *  here); omitted = not resolved at all (the coarse pre-filter / sync-test
   *  callers), which must NOT be read as "definitely unlinked". */
  resolvedConversationId?: ConversationId | null
): WorkflowTrigger | null {
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
    case 'conversation.attribute_changed': {
      // An AI classification write is service-actored (Quinn), same as
      // assistant.handed_off below, so this trigger opts out of the
      // automated-actor gate the same way. IMPORTANT: this opt-out is NOT
      // where the re-trigger loop is prevented — a workflow's own
      // set_attribute action never even reaches here, because
      // set-attribute.service.ts (the emit site) never fires this event for
      // src 'workflow' in the first place. allowServiceActor only lets a
      // real AI write (src 'ai', service-actored) through; actorType stays
      // truthful for any other consumer.
      return {
        triggerType: event.type,
        conversationId: event.data.conversationId as ConversationId,
        actorType,
        allowServiceActor: true,
        subjectPrincipalId: null,
        message: null,
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
    case 'conversation.customer_unresponsive':
    case 'conversation.teammate_unresponsive': {
      // Synthetic, timer-driven (workflow-sweep.ts's 5-minute tick) — no human
      // or service principal ever "causes" silence, so this opts out of the
      // automated-actor gate the same way assistant.handed_off does above.
      // Mapped here mainly so processEvent's own eventToWorkflowTrigger
      // pre-check (events/process.ts) enqueues the event onto the durable
      // dispatch queue at all, and so this switch keeps its 1:1 coverage of
      // DISPATCHABLE_TRIGGER_TYPES. dispatchWorkflowsForEvent below hands this
      // trigger to dispatchWorkflowTrigger with `targetWorkflowId:
      // event.data.workflowId` — the ONE live workflow the sweep already
      // determined qualifies (its own inactivityMinutes threshold) — rather
      // than the untargeted generic fan-out, because the fan-out has no
      // concept of a per-workflow threshold.
      //
      // subjectPrincipalId is deliberately OMITTED (not set to null): this
      // event's payload (conversationId/workflowId/silenceMinutes/sinceAt)
      // never carries the visitor's principal id, so there is nothing to put
      // here — dispatchWorkflowTrigger derives the real subject itself from
      // the resolved ctx.conversation.visitorPrincipalId once it has a
      // context to read (see its own doc). The conversation's visitor IS the
      // frequency-cap subject for "this customer/teammate has gone quiet".
      return {
        triggerType: event.type,
        conversationId: event.data.conversationId as ConversationId,
        actorType,
        allowServiceActor: true,
        message: null,
      }
    }
    case 'sla.approaching_breach':
    case 'sla.breached': {
      // Synthetic, timer-driven (the SLA domain's deadline scan, see
      // sla.service.ts) — same automated-actor opt-out rationale as the
      // unresponsive pair above. Unlike that pair, THIS trigger type DOES
      // dispatch through the normal multi-workflow fan-out below: the SLA
      // domain's fire-once dedupe is a CAS-guarded marker on `sla_applied`
      // scoped per (conversation, clock), not per workflow, so there is no
      // single target workflow to route to (see sla.service.ts's
      // sweepApproachingSlaBreaches doc for the trade-off this implies).
      // subjectPrincipalId is null: SLA frequency caps aren't per-person.
      return {
        triggerType: event.type,
        conversationId: event.data.conversationId as ConversationId,
        actorType,
        allowServiceActor: true,
        subjectPrincipalId: null,
        message: null,
      }
    }
    case 'ticket.created': {
      // Do NOT opt into allowServiceActor: a workflow's own set_ticket_status/
      // convert_to_ticket action runs under the engine's bounded service actor
      // (action.executor.ts's ticketActionActor), and ticket.created is never
      // itself produced by an action, so no loop-safety opt-out is needed —
      // the automated-actor gate simply blocks a service-authored ticket.created
      // from ever reaching here (there isn't one in practice for this event).
      if (resolvedConversationId === null) return null
      return {
        triggerType: event.type,
        conversationId: resolvedConversationId ?? UNRESOLVED_TICKET_CONVERSATION_ID,
        actorType,
        subjectPrincipalId: null,
        message: null,
      }
    }
    case 'ticket.status_changed': {
      // Loop safety: setTicketStatus (called by the engine's set_ticket_status
      // action, via a bounded service actor) fires this same event type. No
      // allowServiceActor opt-out here means the human-actor gate blocks a
      // workflow's own status write from ever re-triggering a
      // ticket.status_changed workflow — see action.executor.test.ts's
      // dedicated loop-safety coverage.
      if (resolvedConversationId === null) return null
      // previousStatus/newStatus are already the INTERNAL CATEGORY axis (see
      // ticket.webhooks.ts's TicketStatusChangedPayload doc — not the raw
      // status name), so no extra status lookup is needed here. A genuine
      // category crossing (previousStatus !== newStatus; same-category churn
      // between two statuses that share a category is NOT a crossing) is what
      // triggerSettings.ticketStatusCategory's "enters this category" wording
      // means — dispatcher.ts's own per-workflow filter compares against this
      // resolved value, never the raw event payload.
      const { previousStatus, newStatus } = event.data
      return {
        triggerType: event.type,
        conversationId: resolvedConversationId ?? UNRESOLVED_TICKET_CONVERSATION_ID,
        actorType,
        subjectPrincipalId: null,
        message: null,
        ticketStatusCategory:
          previousStatus === newStatus ? null : (newStatus as TicketStatusCategory),
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
  // Funnel (the per-workflow sent -> engaged -> completed rollup,
  // workflow-reporting.ts): the customer answered a parked block — a
  // `block_engaged` event, logged only on an actual claim (a raced/no-op
  // resume, `resumed` null, logs nothing extra). `resumed` is
  // resumeWorkflowRun's own return value — the run's FULL post-resume row,
  // unlike the narrow `{id, cursor}` `run` above — so its workflowId/
  // subjectPrincipalId are already in hand with no extra read.
  if (resumed) {
    await logRunEvent(resumed.id, resumed.workflowId, resumed.subjectPrincipalId, 'block_engaged')
  }
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
  // Funnel: only 'escalated' (assistant.handed_off — Quinn escalating mid-
  // conversation, driven by the customer's own turn) is a CUSTOMER-driven
  // engagement signal. 'resolved' (a close — dispatchWorkflowsForEvent's
  // isClose branch) ends the wait via Quinn or an agent resolving the
  // conversation, not the customer answering anything, so it does not count
  // toward the funnel. A teammate message never reaches this function at
  // all (it interrupts instead, see isInterruptingEvent) so there is no
  // separate teammate-interrupt case to exclude here.
  if (resumed && outcome === 'escalated') {
    await logRunEvent(resumed.id, resumed.workflowId, resumed.subjectPrincipalId, 'block_engaged')
  }
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
  // The unresponsive pair routes to a single pre-selected workflow — see
  // dispatchWorkflowTrigger's `targetWorkflowId` doc — instead of the generic
  // fan-out below — never interrupts/resumes anything (silence can't matter
  // to a parked wait the way a reply or close does), so this returns
  // immediately rather than falling into the interrupt-then-dispatch
  // machinery below.
  if (
    event.type === 'conversation.customer_unresponsive' ||
    event.type === 'conversation.teammate_unresponsive'
  ) {
    const trigger = eventToWorkflowTrigger(event)
    if (!trigger) return // unreachable: the switch above always maps these two types
    await dispatchWorkflowTrigger(trigger, {
      targetWorkflowId: event.data.workflowId as WorkflowId,
    })
    return
  }

  // Ticket triggers (ticket.created / ticket.status_changed): resolve the
  // ticket's linked customer conversation FIRST (the async step
  // eventToWorkflowTrigger itself can't do — see its doc), then hand the
  // resolved id to eventToWorkflowTrigger to build the real trigger. No
  // linked conversation -> no dispatch. Ticket events never interrupt/resume
  // anything (that machinery is keyed off message/close activity on the
  // conversation side, not a ticket lifecycle event), so — like the
  // unresponsive pair above — this dispatches straight through rather than
  // falling into the interrupt-then-dispatch machinery below.
  if (event.type === 'ticket.created' || event.type === 'ticket.status_changed') {
    const conversationId = await resolveTicketConversationId(event.data.ticket.id)
    if (!conversationId) return
    const trigger = eventToWorkflowTrigger(event, conversationId)
    if (!trigger) return // unreachable: a resolved conversationId always builds a trigger
    await dispatchWorkflowTrigger(trigger)
    return
  }

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
