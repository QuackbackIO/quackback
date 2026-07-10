/**
 * Dispatcher guards (support platform §4.6, Slice 5d-ii): the checks the
 * dispatcher consults before starting a run — the trigger channel scope (pure,
 * no DB), the per-person frequency cap, and the customer_facing exclusive lock
 * (both DB reads) — plus the transaction-scoped frequency-cap claim
 * (claimFrequencyCapSlot) runWorkflow uses to make that cap race-proof under
 * concurrency. Kept out of the dispatcher/engine so the dispatcher's flow
 * (human gate, class split, first-match) unit-tests without a DB, and so the
 * advisory-lock key format has one owner instead of drifting between callers.
 */
import {
  db,
  and,
  eq,
  gte,
  inArray,
  count,
  sql,
  workflows,
  workflowRuns,
  workflowRunEvents,
  conversationMessages,
  type Workflow,
  type WorkflowRun,
  type Transaction,
  type BlockReplyMetadata,
} from '@/lib/server/db'
import type { ConversationId, PrincipalId, ConversationMessageId } from '@quackback/ids'
import type { FrequencyCap } from './workflow.schemas'

type Executor = typeof db | Transaction

/**
 * `workflow`'s frequency cap, normalized: a missing cap and a stored
 * 'unlimited' one (the no-op value the builder never actually writes, see
 * workflow-graph.ts) both read as undefined, so callers only ever need to
 * handle the "there's a real cap to enforce" case.
 */
export function readFrequencyCap(workflow: Workflow): FrequencyCap | undefined {
  const cap = (workflow.triggerSettings as { frequencyCap?: FrequencyCap }).frequencyCap
  return cap && cap.type !== 'unlimited' ? cap : undefined
}

/**
 * Whether `workflow` has a per-person frequency cap that actually needs
 * enforcing (i.e. configured and not 'unlimited'). Exported so callers that
 * pay for extra work only when a cap exists (runWorkflow's race-proofing
 * advisory lock) can gate on it without duplicating triggerSettings' shape.
 */
export function hasFrequencyCap(workflow: Workflow): boolean {
  return readFrequencyCap(workflow) !== undefined
}

/**
 * Whether a per-person frequency cap permits another run of `workflow` for
 * `subjectPrincipalId`. Caps count 'started' run events. No cap (or an anonymous
 * subject a per-person cap can't key on) is always allowed.
 *
 * `executor` defaults to the module-level `db` for the dispatcher's cheap
 * pre-check (read-then-act, not race-proof on its own); runWorkflow passes
 * its transaction handle instead to re-check authoritatively after taking the
 * per-(workflow, person) advisory lock, so the two calls observe a
 * consistent count instead of racing.
 */
export async function frequencyCapAllows(
  workflow: Workflow,
  subjectPrincipalId: PrincipalId | null,
  executor: Executor = db
): Promise<boolean> {
  const cap = readFrequencyCap(workflow)
  if (!cap) return true
  if (!subjectPrincipalId) return true

  const filters = [
    eq(workflowRunEvents.workflowId, workflow.id),
    eq(workflowRunEvents.subjectPrincipalId, subjectPrincipalId),
    eq(workflowRunEvents.kind, 'started'),
  ]
  if (cap.type === 'once_per_days') {
    filters.push(gte(workflowRunEvents.at, new Date(Date.now() - cap.days * 86_400_000)))
  }
  const [{ n }] = await executor
    .select({ n: count() })
    .from(workflowRunEvents)
    .where(and(...filters))

  if (cap.type === 'n_total') return n < cap.count
  // once / once_per_days: allowed only with no prior run in scope.
  return n === 0
}

/**
 * Claim the per-(workflow, person) frequency-cap slot inside `tx`, for a
 * workflow runWorkflow has already determined needs the race-proofing (see
 * hasFrequencyCap): takes a pg_advisory_xact_lock keyed on
 * `${workflowId}:${subjectPrincipalId}` (session-reentrant, so it never
 * self-deadlocks; releases automatically at commit or rollback) to serialize
 * concurrent triggers for that exact pair, then re-checks the cap
 * authoritatively under that lock via frequencyCapAllows. Returns whether the
 * caller may proceed with the run insert — false means the cap is exhausted
 * on this authoritative recheck, unlike the dispatcher's own
 * frequencyCapAllows call, which is only a cheap pre-check (see its own doc
 * comment). The lock-key format is owned here, alongside the cap-count read
 * it pairs with, so it can't drift between callers the way an inline literal
 * in each call site could.
 */
export async function claimFrequencyCapSlot(
  tx: Transaction,
  workflow: Workflow,
  subjectPrincipalId: PrincipalId
): Promise<boolean> {
  const lockKey = `${workflow.id}:${subjectPrincipalId}`
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`)
  return frequencyCapAllows(workflow, subjectPrincipalId, tx)
}

/**
 * Whether the workflow's `triggerSettings.channels` allows `channel`. The
 * builder writes a non-empty array of channel values (messenger/email/
 * web_form) to scope a trigger to specific channels; empty means "all
 * channels". Defensive by construction: a missing, non-array, or empty
 * `channels` (or an unresolvable `channel`) always allows.
 */
export function channelAllows(workflow: Workflow, channel: string | null | undefined): boolean {
  const channels = workflow.triggerSettings.channels
  if (!Array.isArray(channels) || channels.length === 0) return true
  if (!channel) return true
  return channels.includes(channel)
}

/**
 * Whether a customer_facing run is already live (running or waiting) on the
 * conversation — the exclusive lock. Background runs never lock, so the join
 * filters to customer_facing.
 */
export async function hasActiveCustomerFacingRun(conversationId: ConversationId): Promise<boolean> {
  const [row] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflowRuns.workflowId, workflows.id))
    .where(
      and(
        eq(workflowRuns.conversationId, conversationId),
        inArray(workflowRuns.state, ['running', 'waiting']),
        eq(workflows.class, 'customer_facing')
      )
    )
    .limit(1)
  return Boolean(row)
}

/**
 * The conversation's parked customer-facing run, or null — event-trigger.ts's
 * resume-vs-interrupt check (Phase C, slice C-1). Filters `state = 'waiting'`
 * only (a 'running' row has nothing parked to match a reply against) and
 * reads `workflowRuns.customerFacing` directly (denormalized at run-insert
 * time, per the schema doc) rather than joining `workflows` the way
 * hasActiveCustomerFacingRun does — the exclusive-lock partial index means at
 * most one row can ever match, so there is nothing a join could additionally
 * narrow here. Served by the existing `workflow_runs_conversation_state_idx`
 * (conversationId, state) index; the one indexed lookup the contract calls
 * for on every visitor message.created.
 *
 * Selects only `id` + `cursor` (not the full row, which includes the
 * multi-KB `graph` snapshot) — both call sites (event-trigger.ts's
 * tryResumeInputWait/tryResumeAssistantWait) only ever read `run.id` and
 * `readCursor(run)`, and readCursor's own parameter type
 * (`Pick<WorkflowRun, 'cursor'>`) already only needs the latter.
 */
export async function findWaitingCustomerFacingRun(
  conversationId: ConversationId
): Promise<Pick<WorkflowRun, 'id' | 'cursor'> | null> {
  const [row] = await db
    .select({ id: workflowRuns.id, cursor: workflowRuns.cursor })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.conversationId, conversationId),
        eq(workflowRuns.state, 'waiting'),
        eq(workflowRuns.customerFacing, true)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * A message's stored structured reply, by primary key — the narrow second
 * read event-trigger.ts's resume-vs-interrupt check makes, and ONLY after
 * findWaitingCustomerFacingRun above found an actual candidate to match
 * against; an ordinary message.created event (the overwhelming majority, no
 * waiting customer_facing run on the conversation) never reaches this.
 */
export async function readMessageBlockReply(
  messageId: ConversationMessageId
): Promise<BlockReplyMetadata | null> {
  const [row] = await db
    .select({ metadata: conversationMessages.metadata })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
    .limit(1)
  return row?.metadata?.blockReply ?? null
}
