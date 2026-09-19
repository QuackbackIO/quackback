/**
 * Durable Quinn run records: the transaction-aware primitives.
 *
 * ## One lock order, everywhere
 *
 * **conversation row, then run row, then job row.** Claim, publication,
 * takeover and recovery all take the locks in that order and no other. The
 * conversation is first because it is the row every other participant already
 * locks (intake, takeover, the inactivity sweep), so putting it anywhere else
 * would deadlock against code that is not part of this feature.
 *
 * ## What actually fences a publication
 *
 * Three facts, all read INSIDE the publication transaction while the
 * conversation row is locked:
 *
 * 1. `conversations.assistant_revision` still equals the run's
 *    `input_revision`. Every input or authority change bumps the counter, so
 *    this one comparison covers a newer customer message, a human reply, a
 *    takeover, a close, a snooze, a spam filing and an explicit handback.
 * 2. The run still carries the lease token this worker was claimed with. A
 *    reaped worker that wakes up and finishes its generation holds an old
 *    token and updates zero rows.
 * 3. No terminal customer-visible message exists for the run yet. The partial
 *    unique index on `conversation_messages.assistant_run_id` is the backstop
 *    for the same fact, so a replay cannot post the answer twice even if it
 *    somehow passed the first two.
 *
 * Reading any of them outside the transaction proves nothing: the reaper and a
 * new owner are both racing the same row.
 */
import { randomUUID } from 'node:crypto'
import {
  db,
  and,
  eq,
  ne,
  sql,
  conversations,
  assistantRuns,
  type AssistantRunDelegation,
  type AssistantRunOutcome,
  type AssistantRunPhase,
  type AssistantRunStatus,
  type AssistantRunSurface,
  type AssistantRunTriggerKind,
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type {
  AssistantInvolvementId,
  AssistantRunId,
  AssistantSnapshotId,
  ConversationId,
  ConversationMessageId,
  PrincipalId,
} from '@quackback/ids'

export type AssistantRunRow = typeof assistantRuns.$inferSelect

/** Statuses that still owe the customer an outcome. */
export const OPEN_RUN_STATUSES: readonly AssistantRunStatus[] = [
  'queued',
  'running',
  'waiting_action',
]

export interface RunIntentInput {
  conversationId: ConversationId
  surface: AssistantRunSurface
  triggerKind: AssistantRunTriggerKind
  triggerKey: string
  triggerMessageId?: ConversationMessageId | null
  delegation?: AssistantRunDelegation | null
  requestedByPrincipalId?: PrincipalId | null
  involvementId?: AssistantInvolvementId | null
  inputRevision: number
}

/**
 * Bump the conversation's invalidation counter and return the new value.
 *
 * The UPDATE takes the row lock, so a caller that is about to insert a run
 * intent already holds the first lock in the documented order. Callers that
 * only mean to invalidate (a human reply, a close) call this and nothing else.
 */
export async function bumpAssistantRevision(
  tx: Executor,
  conversationId: ConversationId
): Promise<number> {
  const [row] = await tx
    .update(conversations)
    .set({ assistantRevision: sql`${conversations.assistantRevision} + 1` })
    .where(eq(conversations.id, conversationId))
    .returning({ revision: conversations.assistantRevision })
  return row?.revision ?? 0
}

/** Current invalidation counter, without changing it. */
export async function readAssistantRevision(
  exec: Executor,
  conversationId: ConversationId
): Promise<number | null> {
  const [row] = await exec
    .select({ revision: conversations.assistantRevision })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  return row?.revision ?? null
}

/**
 * Mark every still-open run on this conversation superseded, except one.
 *
 * Latest-input-wins: a newer input's intake calls this so an older queued run
 * never starts, and an older RUNNING run is told at its own publication fence
 * that it lost. Superseding a running row does not stop its generation; the
 * revision comparison does. This only makes the reason legible.
 */
export async function supersedeOpenRuns(
  tx: Executor,
  conversationId: ConversationId,
  opts: { exceptRunId?: AssistantRunId | null; disposition: string }
): Promise<number> {
  const rows = await tx
    .update(assistantRuns)
    .set({
      status: 'superseded',
      disposition: opts.disposition,
      finishedAt: new Date(),
      updatedAt: new Date(),
      stateVersion: sql`${assistantRuns.stateVersion} + 1`,
    })
    .where(
      and(
        eq(assistantRuns.conversationId, conversationId),
        sql`${assistantRuns.status} IN ('queued', 'running', 'waiting_action')`,
        opts.exceptRunId ? ne(assistantRuns.id, opts.exceptRunId) : undefined
      )
    )
    .returning({ id: assistantRuns.id })
  return rows.length
}

/**
 * Insert the run intent, or return the one this trigger already has.
 *
 * The unique trigger key is what makes intake idempotent: a retried intake for
 * the same persisted message resolves to the same run rather than minting a
 * second one, and the caller can tell the difference through `created` so it
 * does not enqueue a second job.
 */
export async function insertRunIntent(
  tx: Executor,
  input: RunIntentInput
): Promise<{ run: AssistantRunRow; created: boolean }> {
  const inserted = await tx
    .insert(assistantRuns)
    .values({
      conversationId: input.conversationId,
      surface: input.surface,
      triggerKind: input.triggerKind,
      triggerKey: input.triggerKey,
      triggerMessageId: input.triggerMessageId ?? null,
      delegation: input.delegation ?? null,
      requestedByPrincipalId: input.requestedByPrincipalId ?? null,
      involvementId: input.involvementId ?? null,
      inputRevision: input.inputRevision,
      status: 'queued',
    })
    .onConflictDoNothing({ target: assistantRuns.triggerKey })
    .returning()
  if (inserted.length > 0) return { run: inserted[0], created: true }
  const [existing] = await tx
    .select()
    .from(assistantRuns)
    .where(eq(assistantRuns.triggerKey, input.triggerKey))
    .limit(1)
  if (!existing) throw new Error('run intent neither inserted nor found')
  return { run: existing, created: false }
}

export async function loadRun(
  exec: Executor,
  runId: AssistantRunId
): Promise<AssistantRunRow | null> {
  const [row] = await exec.select().from(assistantRuns).where(eq(assistantRuns.id, runId)).limit(1)
  return row ?? null
}

/** The conversation fields the fences read, under the lock the caller took. */
export interface FencedConversationState {
  id: ConversationId
  status: string
  snoozedUntil: Date | null
  endReason: string | null
  assistantRevision: number
}

/**
 * Take the first lock in the documented order and return what the fences need.
 *
 * `FOR UPDATE` rather than `FOR NO KEY UPDATE`: the publication transaction is
 * about to write the conversation row itself, and a claim that took a weaker
 * lock than the publication would let two workers past the same gate.
 */
export async function lockConversationForRun(
  tx: Executor,
  conversationId: ConversationId
): Promise<FencedConversationState | null> {
  const [row] = await tx
    .select({
      id: conversations.id,
      status: conversations.status,
      snoozedUntil: conversations.snoozedUntil,
      endReason: conversations.endReason,
      assistantRevision: conversations.assistantRevision,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
    .for('update')
  return row ?? null
}

/** Second lock in the documented order. */
export async function lockRun(
  tx: Executor,
  runId: AssistantRunId
): Promise<AssistantRunRow | null> {
  const [row] = await tx
    .select()
    .from(assistantRuns)
    .where(eq(assistantRuns.id, runId))
    .limit(1)
    .for('update')
  return row ?? null
}

export interface ClaimRunInput {
  runId: AssistantRunId
  jobId: string
  leaseToken: string
}

export type ClaimRunOutcome =
  | { kind: 'claimed'; run: AssistantRunRow }
  /** A previous attempt already committed an outcome; the replay must finish harmlessly. */
  | { kind: 'already_settled'; run: AssistantRunRow }
  /** A newer input or an authority change won. The run is now terminal. */
  | { kind: 'superseded'; run: AssistantRunRow; reason: string }
  | { kind: 'missing' }

/**
 * Take execution ownership of a queued run.
 *
 * Runs in its own short transaction, in the documented lock order, and commits
 * before the generation starts: holding a transaction open across a model call
 * is exactly what the queue's lease design exists to avoid.
 */
export async function claimRunForExecution(
  input: ClaimRunInput,
  exec: Executor = db
): Promise<ClaimRunOutcome> {
  return exec.transaction(async (tx) => {
    const preview = await loadRun(tx, input.runId)
    if (!preview) return { kind: 'missing' }
    if (preview.conversationId) await lockConversationForRun(tx, preview.conversationId)
    const run = await lockRun(tx, input.runId)
    if (!run) return { kind: 'missing' }
    if (!OPEN_RUN_STATUSES.includes(run.status)) return { kind: 'already_settled', run }

    const revision = run.conversationId
      ? await readAssistantRevision(tx, run.conversationId)
      : run.inputRevision
    if (revision !== run.inputRevision) {
      const settled = await settleRun(tx, {
        runId: run.id,
        status: 'superseded',
        disposition: 'fence:input_revision',
        expectedStateVersion: run.stateVersion,
      })
      return { kind: 'superseded', run: settled ?? run, reason: 'fence:input_revision' }
    }

    const [claimed] = await tx
      .update(assistantRuns)
      .set({
        status: 'running',
        phase: 'context',
        jobId: input.jobId,
        jobLeaseToken: input.leaseToken,
        attemptCount: sql`${assistantRuns.attemptCount} + 1`,
        stateVersion: sql`${assistantRuns.stateVersion} + 1`,
        startedAt: run.startedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(assistantRuns.id, run.id), eq(assistantRuns.stateVersion, run.stateVersion)))
      .returning()
    if (!claimed) return { kind: 'already_settled', run }
    return { kind: 'claimed', run: claimed }
  })
}

export interface SettleRunInput {
  runId: AssistantRunId
  status: AssistantRunStatus
  outcome?: AssistantRunOutcome | null
  phase?: AssistantRunPhase
  disposition?: string | null
  errorReason?: string | null
  resultMessageId?: ConversationMessageId | null
  snapshotId?: AssistantSnapshotId | null
  involvementId?: AssistantInvolvementId | null
  /** Compare-and-set guard. Omit only where the caller already holds the run lock and checked. */
  expectedStateVersion?: number
  expectedLeaseToken?: string
}

/** Move a run to a terminal (or waiting) state, guarded by the fences the caller names. */
export async function settleRun(
  tx: Executor,
  input: SettleRunInput
): Promise<AssistantRunRow | null> {
  const [row] = await tx
    .update(assistantRuns)
    .set({
      status: input.status,
      ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.disposition !== undefined ? { disposition: input.disposition } : {}),
      ...(input.errorReason !== undefined ? { errorReason: input.errorReason } : {}),
      ...(input.resultMessageId !== undefined ? { resultMessageId: input.resultMessageId } : {}),
      ...(input.snapshotId !== undefined ? { snapshotId: input.snapshotId } : {}),
      ...(input.involvementId !== undefined ? { involvementId: input.involvementId } : {}),
      stateVersion: sql`${assistantRuns.stateVersion} + 1`,
      updatedAt: new Date(),
      ...(input.status === 'waiting_action' ? {} : { finishedAt: new Date() }),
    })
    .where(
      and(
        eq(assistantRuns.id, input.runId),
        input.expectedStateVersion === undefined
          ? undefined
          : eq(assistantRuns.stateVersion, input.expectedStateVersion),
        input.expectedLeaseToken === undefined
          ? undefined
          : eq(assistantRuns.jobLeaseToken, input.expectedLeaseToken)
      )
    )
    .returning()
  return row ?? null
}

/** Attach the frozen behaviour a run executed under. Diagnostic, never a fence. */
export async function attachSnapshot(
  exec: Executor,
  runId: AssistantRunId,
  snapshotId: AssistantSnapshotId
): Promise<void> {
  await exec
    .update(assistantRuns)
    .set({ snapshotId, updatedAt: new Date() })
    .where(eq(assistantRuns.id, runId))
}

/** A stable execution token for callers that need one outside the queue (tests, recovery). */
export function newExecutionToken(): string {
  return randomUUID()
}
