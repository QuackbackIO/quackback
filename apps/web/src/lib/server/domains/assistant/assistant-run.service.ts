/**
 * Durable Quinn turns — intake, execution and fenced publication.
 *
 * Three seams, in the order a turn travels through them:
 *
 * - `requestAssistantTurn(tx, ...)` runs inside the transaction that persisted
 *   the input. It bumps the conversation's invalidation counter, supersedes any
 *   older uncommitted run, writes the run intent and enqueues the job on the
 *   SAME transaction. A rollback leaves no run and no job; a commit leaves work
 *   that is claimable even if this process dies in the next millisecond.
 * - `advanceAssistantRun(job)` claims execution ownership with the queue's own
 *   lease token, freezes the effective behaviour, generates a candidate, then
 *   asks for publication. It holds no transaction across the model call.
 * - `commitAssistantOutcome(tx, ...)` is the only place a customer-visible
 *   Quinn message is written in durable mode. It verifies every fence under the
 *   conversation lock and commits the transcript message, the run result, the
 *   involvement update, the inactivity ownership (via migration 0284's trigger,
 *   which derives it from this message in the same statement) and the outbox
 *   event together.
 *
 * Lock order is the repository's: conversation row, then run row, then job row.
 *
 * What this module deliberately does NOT do: retry. The turn job is enqueued
 * with `maxAttempts: 1`, so a process death means the run is reported failed
 * and the customer is escalated, never that a half-dispatched turn runs twice.
 * Write-capable retries wait for replay-safe tool receipts (P3).
 */
import { db, sql, conversations, eq } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { Conversation, ConversationMessage, Transaction } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { EventData } from '@/lib/server/events/types'
import type {
  AssistantRunId,
  ConversationId,
  ConversationMessageId,
  PrincipalId,
} from '@quackback/ids'
import type { ConversationMessageCitation } from '@/lib/shared/conversation/types'
import type { ConversationAuthorInput } from '@/lib/server/domains/conversation/conversation.types'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import {
  bumpAssistantRevision,
  insertRunIntent,
  lockConversationForRun,
  lockRun,
  loadRun,
  settleRun,
  supersedeOpenRuns,
  recordRunEvidence,
  type AssistantRunRow,
  type RunEvidenceInput,
} from './assistant-run.repository'

/** The queue a durable customer turn runs on. */
export const ASSISTANT_TURN_QUEUE = 'assistant-turn'

/** Stable business identity of a customer message trigger. */
export function customerMessageTriggerKey(
  conversationId: ConversationId,
  messageId: ConversationMessageId
): string {
  return `conversation:${conversationId}:message:${messageId}`
}

/** Stable business identity of a workflow delegation trigger. */
export function workflowDelegationTriggerKey(
  workflowRunId: string,
  nodeId: string,
  waitSeq: number
): string {
  return `workflow:${workflowRunId}:${nodeId}:${waitSeq}`
}

export interface RequestAssistantTurnInput {
  conversationId: ConversationId
  triggerKey: string
  triggerKind: 'customer_message' | 'workflow_delegation' | 'agent_handback'
  surface: 'widget' | 'workflow_step'
  triggerMessageId?: ConversationMessageId | null
  delegation?: { workflowRunId: string; nodeId: string; waitSeq: number } | null
  requestedByPrincipalId?: PrincipalId | null
  /** One-time instruction from a workflow step, carried on the job payload. */
  stepInstructions?: string | null
}

export interface RequestAssistantTurnResult {
  run: AssistantRunRow
  /** False when this trigger already had a run, so no second job was enqueued. */
  created: boolean
  inputRevision: number
}

/**
 * Persist the intent to answer, in the caller's transaction.
 *
 * The revision bump lives here rather than at the call sites so an input can
 * never invalidate older work without also scheduling work over the new state,
 * or schedule work under a revision it did not take.
 */
export async function requestAssistantTurn(
  tx: Transaction,
  input: RequestAssistantTurnInput
): Promise<RequestAssistantTurnResult> {
  const inputRevision = await bumpAssistantRevision(tx, input.conversationId)
  // Latest input wins. An older QUEUED run must never start; an older RUNNING
  // run is already dead by the revision comparison, and this only records why.
  await supersedeOpenRuns(tx, input.conversationId, { disposition: 'fence:newer_input' })

  const { run, created } = await insertRunIntent(tx, {
    conversationId: input.conversationId,
    surface: input.surface,
    triggerKind: input.triggerKind,
    triggerKey: input.triggerKey,
    triggerMessageId: input.triggerMessageId ?? null,
    delegation: input.delegation ?? null,
    requestedByPrincipalId: input.requestedByPrincipalId ?? null,
    inputRevision,
  })

  if (created) {
    // Same transaction as the run row: a failed job insert rolls the intent
    // back with it, so there is no accepted message whose mandatory work
    // silently vanished. maxAttempts is explicit and is 1 — see the module doc.
    await enqueueJob({
      queue: ASSISTANT_TURN_QUEUE,
      payload: {
        runId: run.id,
        conversationId: input.conversationId,
        ...(input.stepInstructions ? { stepInstructions: input.stepInstructions } : {}),
      },
      dedupeKey: `assistant-turn:${run.id}`,
      maxAttempts: 1,
      executor: tx,
    })
  }

  return { run, created, inputRevision }
}

/**
 * Invalidate any in-flight Quinn work for a conversation.
 *
 * The one call every human-ownership and lifecycle transition makes: a reply,
 * a takeover, an assignment, a handoff, a close, a reopen, a snooze, an
 * unsnooze, a spam filing, an inactivity mode change, an explicit handback.
 * It is deliberately cheap (one UPDATE, plus one more when a run is open) so
 * no call site has a reason to skip it.
 */
export async function invalidateAssistantWork(
  tx: Executor,
  conversationId: ConversationId,
  reason: string
): Promise<void> {
  await bumpAssistantRevision(tx, conversationId)
  await supersedeOpenRuns(tx, conversationId, { disposition: `fence:${reason}` })
}

/** Why a candidate was refused publication. Recorded on the run as its disposition. */
export type PublicationRejection =
  | 'fence:conversation_missing'
  | 'fence:run_missing'
  | 'fence:run_status'
  | 'fence:lease_token'
  | 'fence:state_version'
  | 'fence:input_revision'
  | 'fence:conversation_closed'
  | 'fence:conversation_snoozed'
  | 'fence:paired_ticket'
  | 'fence:handed_off'

export interface AssistantCandidate {
  text: string
  /** What the customer sees. Drives migration 0284's inactivity trigger. */
  responseKind: 'answer' | 'clarification' | 'greeting'
  /** The run's own outcome vocabulary, which distinguishes an inability from a clarification. */
  outcome: 'answer' | 'clarification' | 'greeting' | 'inability'
  citations: ConversationMessageCitation[]
  handoff: {
    reason: string
    customerNeed: string
    attempted: string[]
    recommendedNextStep: string
  } | null
}

export interface CommitAssistantOutcomeInput {
  runId: AssistantRunId
  conversationId: ConversationId
  expectedInputRevision: number
  expectedStateVersion: number
  jobLeaseToken: string
  candidate: AssistantCandidate
  author: ConversationAuthorInput
  evidence?: readonly Omit<RunEvidenceInput, 'runId' | 'attemptNumber'>[]
}

export type CommitAssistantOutcomeResult =
  | {
      kind: 'published'
      messageId: ConversationMessageId
      involvementId: string | null
      /** Run after commit, for the caller's post-commit effects. */
      run: AssistantRunRow
      publication: { conversation: Conversation; message: ConversationMessage }
      handoff: AssistantCandidate['handoff']
      /** The outbox row is already written; these reactions run after the commit. */
      sideHookEvent: EventData
    }
  /** A previous attempt already committed this run's outcome. Finish harmlessly. */
  | { kind: 'already_published'; messageId: ConversationMessageId | null }
  | { kind: 'rejected'; reason: PublicationRejection }

/**
 * The fenced publication.
 *
 * Every check below is read inside `tx` while the conversation row is locked,
 * because each one is a statement about a row somebody else is racing. The
 * order is cheapest-and-most-decisive first so a lost race costs one lock and
 * two reads.
 */
export async function commitAssistantOutcome(
  tx: Transaction,
  input: CommitAssistantOutcomeInput
): Promise<CommitAssistantOutcomeResult> {
  const conversation = await lockConversationForRun(tx, input.conversationId)
  if (!conversation) return { kind: 'rejected', reason: 'fence:conversation_missing' }
  const run = await lockRun(tx, input.runId)
  if (!run) return { kind: 'rejected', reason: 'fence:run_missing' }

  // A replay of a job whose outcome already committed. Not an error: the queue
  // may legitimately re-deliver after the publication transaction committed but
  // before the job row was marked done.
  if (run.resultMessageId) {
    return { kind: 'already_published', messageId: run.resultMessageId }
  }
  if (run.status !== 'running') return { kind: 'rejected', reason: 'fence:run_status' }
  if (run.jobLeaseToken !== input.jobLeaseToken) {
    return { kind: 'rejected', reason: 'fence:lease_token' }
  }
  if (run.stateVersion !== input.expectedStateVersion) {
    return { kind: 'rejected', reason: 'fence:state_version' }
  }
  // The single comparison that covers a newer customer message, a human reply,
  // a takeover, a close, a snooze, a spam filing and an explicit handback.
  if (
    conversation.assistantRevision !== input.expectedInputRevision ||
    run.inputRevision !== input.expectedInputRevision
  ) {
    return { kind: 'rejected', reason: 'fence:input_revision' }
  }
  // Belt and braces for the states an operator would name directly, so a
  // missed revision bump anywhere still cannot produce a reply into a closed or
  // snoozed thread.
  if (conversation.status === 'closed') {
    return { kind: 'rejected', reason: 'fence:conversation_closed' }
  }
  if (conversation.status === 'snoozed') {
    return { kind: 'rejected', reason: 'fence:conversation_snoozed' }
  }

  // Pair ownership: a conversation backing a customer ticket is the ticket's,
  // and Quinn must not front it. Re-read here rather than trusting the probe
  // that ran at intake, because the pair can be created mid-generation.
  const paired = getExecuteRows(
    await tx.execute(sql`
      SELECT 1 FROM ticket_conversations
      WHERE conversation_id = ${input.conversationId} AND ticket_type = 'customer'
      LIMIT 1
    `)
  )
  if (paired.length > 0) return { kind: 'rejected', reason: 'fence:paired_ticket' }

  const { getLatestInvolvement, openInvolvement, recordAssistantAnswer, recordHandoff } =
    await import('./assistant.involvement')
  const latest = await getLatestInvolvement(input.conversationId, tx)
  // Handed off means the team owns the customer. Only the run that is itself
  // performing the handoff may write while that is true, and it cannot be this
  // one: `recordHandoff` below is what sets the status in the first place.
  if (latest?.status === 'handed_off') return { kind: 'rejected', reason: 'fence:handed_off' }

  const wantsInvolvement = input.candidate.responseKind === 'answer' || !!input.candidate.handoff
  const involvement =
    latest?.status === 'active'
      ? latest
      : wantsInvolvement
        ? await openInvolvement(
            { conversationId: input.conversationId, triggeredBy: 'first_touch' },
            tx
          )
        : null

  if (input.candidate.handoff && !involvement) {
    throw new Error('assistant handoff requires an involvement')
  }

  const { appendAssistantReplyTx } =
    await import('@/lib/server/domains/conversation/conversation.service')
  const publication = await appendAssistantReplyTx(
    tx,
    input.conversationId,
    input.candidate.text,
    input.author,
    {
      waiting: !!input.candidate.handoff,
      citations: input.candidate.citations,
      assistantRunId: run.id,
      metadata: {
        assistantResponseKind: input.candidate.handoff ? 'handoff' : input.candidate.responseKind,
      },
    }
  )

  // Involvement transitions ride the same transaction as the message, so an
  // answer and its answer clock can never disagree after a crash.
  if (input.candidate.handoff && involvement) {
    const handed = await recordHandoff(
      involvement.id,
      input.candidate.handoff.reason as Parameters<typeof recordHandoff>[1],
      tx
    )
    if (!handed) return { kind: 'rejected', reason: 'fence:handed_off' }
  } else if (input.candidate.responseKind === 'answer' && involvement) {
    await recordAssistantAnswer(
      involvement.id,
      {
        sources: input.candidate.citations.map((c) => ({
          type: c.type,
          id: c.id,
          title: c.title,
          url: c.url,
        })),
      },
      tx
    )
  }

  const settled = await settleRun(tx, {
    runId: run.id,
    status: 'succeeded',
    phase: 'publication',
    outcome: input.candidate.handoff ? 'handoff' : input.candidate.outcome,
    resultMessageId: publication.message.id,
    involvementId: involvement?.id ?? null,
    disposition: null,
    expectedStateVersion: run.stateVersion,
    expectedLeaseToken: input.jobLeaseToken,
  })
  // The compare-and-set lost, which means somebody changed ownership between
  // the lock and here. Impossible while we hold the row lock, so treat it as
  // the corruption it would be rather than publishing regardless.
  if (!settled) throw new Error('run ownership changed inside the publication transaction')

  if (input.evidence?.length) {
    await recordRunEvidence(
      tx,
      input.evidence.map((row) => ({ ...row, runId: run.id, attemptNumber: run.attemptCount }))
    )
  }

  // The domain event goes into the outbox on THIS transaction, so a workflow
  // trigger or webhook can never describe a message the database does not have.
  const { buildMessageCreatedEvent } =
    await import('@/lib/server/domains/conversation/conversation.webhooks')
  const { writeEventToOutbox } = await import('@/lib/server/events/outbox-dispatch')
  const event = buildMessageCreatedEvent(
    {
      principalId: input.author.principalId,
      principalType: 'service',
      role: 'member',
      segmentIds: new Set(),
    },
    input.author,
    publication.message,
    publication.conversation,
    false
  )
  await writeEventToOutbox(event, { executor: tx })

  return {
    kind: 'published',
    messageId: publication.message.id,
    involvementId: involvement?.id ?? null,
    run: settled,
    publication,
    handoff: input.candidate.handoff,
    // The side hooks that are not part of the outbox run after the caller's
    // commit; see advanceAssistantRun.
    sideHookEvent: event,
  }
}

/**
 * Cancel outstanding unpublished runs for a conversation.
 *
 * The rollback primitive: switching the execution selector back to legacy stops
 * new durable intake, and this fences whatever was already in flight without
 * fabricating a resolution for the customer.
 */
export async function cancelOpenAssistantRuns(
  conversationId: ConversationId,
  reason: string,
  exec: Executor = db
): Promise<number> {
  return supersedeOpenRuns(exec, conversationId, { disposition: `cancelled:${reason}` })
}

/** Diagnostic read for the run inspector and the tests. */
export async function getAssistantRun(
  runId: AssistantRunId,
  exec: Executor = db
): Promise<AssistantRunRow | null> {
  return loadRun(exec, runId)
}

/** The conversation's current invalidation counter. */
export async function getAssistantRevision(
  conversationId: ConversationId,
  exec: Executor = db
): Promise<number> {
  const [row] = await exec
    .select({ revision: conversations.assistantRevision })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  return row?.revision ?? 0
}
