/**
 * Tool-call audit log. `claimToolCall` inserts the `started` row via
 * INSERT ... ON CONFLICT DO NOTHING before any side-effect runs, mirroring
 * claimHookDelivery (events/hook-idempotency.ts): the first writer for a given
 * idempotency key wins the row, and a retried call (BullMQ redelivery, a
 * duplicated LLM turn) gets null back and skips its side-effect. Calls with no
 * stable idempotency key always land — the partial unique index only applies
 * where the key is non-null, so two NULLs never conflict.
 */
import { db, and, desc, eq, isNull, or, sql, assistantToolCalls } from '@/lib/server/db'
import type {
  AssistantToolCallStatus,
  AssistantToolReconciliationState,
  AssistantToolReplayStrategy,
} from '@/lib/server/db'
import type {
  AssistantRunId,
  AssistantToolCallId,
  AssistantInvolvementId,
  AssistantPendingActionId,
  ConversationId,
  PrincipalId,
} from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { logger } from '@/lib/server/logger'
import {
  boundedResult,
  settlementFor,
  type AssistantToolCall,
  type ToolOutcome,
} from './tool-receipts'

const log = logger.child({ component: 'assistant-tool-calls-retention' })

export type { AssistantToolCall }

export interface ClaimToolCallInput {
  conversationId?: ConversationId
  involvementId?: AssistantInvolvementId
  pendingActionId?: AssistantPendingActionId
  toolName: string
  args: Record<string, unknown>
  idempotencyKey?: string
  principalId?: PrincipalId
  /** The durable run and step this effect belongs to. */
  runId?: AssistantRunId
  runStepKey?: string
  /**
   * The stable logical identity of the business action. The insert conflicts on
   * this as well as on the per-turn key, so two workers that computed the same
   * action cannot both dispatch it even when their turn keys differ.
   */
  actionKey?: string
  argsDigest?: string
  schemaDigest?: string
  replayStrategy?: AssistantToolReplayStrategy
  providerIdempotencyKey?: string
}

/**
 * Claim a tool call before running its side-effect.
 *
 * Null means somebody already claimed this action, on either of the two unique
 * keys. The caller reads the existing receipt (`findToolReceipt`) and answers
 * from it rather than executing.
 */
export async function claimToolCall(
  input: ClaimToolCallInput,
  exec: Executor = db
): Promise<AssistantToolCall | null> {
  const [row] = await exec
    .insert(assistantToolCalls)
    .values({
      conversationId: input.conversationId ?? null,
      involvementId: input.involvementId ?? null,
      pendingActionId: input.pendingActionId ?? null,
      toolName: input.toolName,
      args: input.args,
      idempotencyKey: input.idempotencyKey ?? null,
      principalId: input.principalId ?? null,
      runId: input.runId ?? null,
      runStepKey: input.runStepKey ?? null,
      actionKey: input.actionKey ?? null,
      argsDigest: input.argsDigest ?? null,
      schemaDigest: input.schemaDigest ?? null,
      replayStrategy: input.replayStrategy ?? null,
      providerIdempotencyKey: input.providerIdempotencyKey ?? null,
      status: 'started',
    })
    .onConflictDoNothing()
    .returning()
  return row ?? null
}

/** Read the recorded disposition after losing an idempotency claim. */
export async function findToolCallByIdempotencyKey(
  key: string,
  exec: Executor = db
): Promise<AssistantToolCall | null> {
  const [row] = await exec
    .select()
    .from(assistantToolCalls)
    .where(eq(assistantToolCalls.idempotencyKey, key))
    .limit(1)
  return row ?? null
}

/**
 * The receipt for a logical action, by either identity.
 *
 * The action key is asked for first because it is the one that survives a run
 * continuation: the per-turn key changes when the customer message does, and a
 * continuation after an approval is a different message for the same action.
 */
export async function findToolReceipt(
  keys: { actionKey?: string | null; idempotencyKey?: string | null },
  exec: Executor = db
): Promise<AssistantToolCall | null> {
  if (keys.actionKey) {
    const [row] = await exec
      .select()
      .from(assistantToolCalls)
      .where(eq(assistantToolCalls.actionKey, keys.actionKey))
      .limit(1)
    if (row) return row
  }
  if (keys.idempotencyKey) return findToolCallByIdempotencyKey(keys.idempotencyKey, exec)
  return null
}

/** The receipt an approved action's execution wrote, if it got that far. */
export async function findReceiptForPendingAction(
  pendingActionId: AssistantPendingActionId,
  exec: Executor = db
): Promise<AssistantToolCall | null> {
  const [row] = await exec
    .select()
    .from(assistantToolCalls)
    .where(eq(assistantToolCalls.pendingActionId, pendingActionId))
    .orderBy(desc(assistantToolCalls.createdAt))
    .limit(1)
  return row ?? null
}

/** Load one receipt by id. */
export async function getToolCallById(
  id: AssistantToolCallId,
  exec: Executor = db
): Promise<AssistantToolCall | null> {
  const [row] = await exec
    .select()
    .from(assistantToolCalls)
    .where(eq(assistantToolCalls.id, id))
    .limit(1)
  return row ?? null
}

/**
 * Record that the effect is about to leave this database.
 *
 * This is the intent commit: it runs BEFORE the provider call, so a process
 * death in the window leaves a row that says "attempted, never confirmed"
 * rather than a row that says nothing. Only stamps once, so a retry inside the
 * same receipt does not move the first attempt's instant.
 */
export async function markToolCallDispatched(
  id: AssistantToolCallId,
  input: { providerIdempotencyKey?: string | null } = {},
  exec: Executor = db
): Promise<void> {
  await exec
    .update(assistantToolCalls)
    .set({
      dispatchedAt: new Date(),
      ...(input.providerIdempotencyKey !== undefined
        ? { providerIdempotencyKey: input.providerIdempotencyKey }
        : {}),
    })
    .where(and(eq(assistantToolCalls.id, id), isNull(assistantToolCalls.dispatchedAt)))
}

export interface FinalizeToolCallInput {
  status: Extract<AssistantToolCallStatus, 'started' | 'succeeded' | 'failed' | 'denied'>
  resultSummary?: string
  error?: string | null
  latencyMs?: number
  outcomeStatus?: NonNullable<AssistantToolCall['outcomeStatus']> | null
  retryable?: boolean | null
  reconciliationState?: AssistantToolReconciliationState | null
  result?: Record<string, unknown> | null
  providerReceipt?: Record<string, unknown> | null
  settledAt?: Date | null
}

/** Fill in the terminal status once a claimed tool call settles. Only the
 *  fields the caller supplies are written; the others are left as-is. */
export async function finalizeToolCall(
  id: AssistantToolCallId,
  input: FinalizeToolCallInput,
  exec: Executor = db
): Promise<void> {
  const values: Partial<typeof assistantToolCalls.$inferInsert> = { status: input.status }
  if (input.resultSummary !== undefined) values.resultSummary = input.resultSummary
  if (input.error !== undefined) values.error = input.error
  if (input.latencyMs !== undefined) values.latencyMs = input.latencyMs
  if (input.outcomeStatus !== undefined) values.outcomeStatus = input.outcomeStatus
  if (input.retryable !== undefined) values.retryable = input.retryable
  if (input.reconciliationState !== undefined) {
    values.reconciliationState = input.reconciliationState
  }
  if (input.result !== undefined) values.result = input.result
  if (input.providerReceipt !== undefined) values.providerReceipt = input.providerReceipt
  if (input.settledAt !== undefined) values.settledAt = input.settledAt
  await exec.update(assistantToolCalls).set(values).where(eq(assistantToolCalls.id, id))
}

/**
 * Settle a receipt from a normalized outcome.
 *
 * The single writer for a tool's terminal state, so the projection onto the two
 * status columns (`settlementFor`) happens in one place and cannot drift. An
 * unknown outcome settles with no `settled_at`: there is nothing settled about
 * it, and the stamp is what the reconciliation queue reads as "resolved".
 */
export async function settleToolCall(
  id: AssistantToolCallId,
  outcome: ToolOutcome,
  extras: {
    resultSummary?: string
    latencyMs?: number
    providerReceipt?: Record<string, unknown> | null
  } = {},
  exec: Executor = db
): Promise<void> {
  const settlement = settlementFor(outcome)
  if (!settlement) return
  await finalizeToolCall(
    id,
    {
      status: settlement.status,
      outcomeStatus: settlement.outcomeStatus,
      retryable: settlement.retryable,
      reconciliationState: settlement.reconciliationState,
      error: settlement.error,
      result: outcome.status === 'succeeded' ? boundedResult(outcome.value) : null,
      settledAt: outcome.status === 'unknown' ? null : new Date(),
      ...(extras.resultSummary !== undefined ? { resultSummary: extras.resultSummary } : {}),
      ...(extras.latencyMs !== undefined ? { latencyMs: extras.latencyMs } : {}),
      ...(extras.providerReceipt !== undefined ? { providerReceipt: extras.providerReceipt } : {}),
    },
    exec
  )
}

/**
 * The receipts nobody can confirm: an effect was attempted and never settled.
 *
 * Read by the reconciliation surface. Two shapes reach it, and both matter: a
 * row the executor itself marked `unknown`, and a row a crash left with a
 * dispatch stamp and no outcome at all, which nobody was alive to label.
 */
export async function listUnreconciledToolCalls(
  limit = 50,
  exec: Executor = db
): Promise<AssistantToolCall[]> {
  return exec
    .select()
    .from(assistantToolCalls)
    .where(
      or(
        eq(assistantToolCalls.reconciliationState, 'required'),
        and(
          eq(assistantToolCalls.status, 'started'),
          sql`${assistantToolCalls.dispatchedAt} IS NOT NULL`,
          isNull(assistantToolCalls.settledAt),
          isNull(assistantToolCalls.reconciliationState)
        )
      )
    )
    .orderBy(desc(assistantToolCalls.createdAt))
    .limit(limit)
}

/**
 * Record a person's verdict on an unconfirmed effect.
 *
 * Deliberately only two verdicts, and neither of them repeats the write. An
 * operator who wants the effect to happen after all issues a new command; a
 * button that re-sent an unconfirmed mutation is the thing this whole path
 * exists to prevent.
 */
export async function reconcileToolCall(
  id: AssistantToolCallId,
  input: {
    verdict: Extract<AssistantToolReconciliationState, 'resolved' | 'failed'>
    note: string
    principalId: PrincipalId
  },
  exec: Executor = db
): Promise<AssistantToolCall | null> {
  const [row] = await exec
    .update(assistantToolCalls)
    .set({
      reconciliationState: input.verdict,
      reconciliationNote: input.note,
      reconciledAt: new Date(),
      reconciledById: input.principalId,
      settledAt: new Date(),
      status: input.verdict === 'resolved' ? 'succeeded' : 'failed',
      outcomeStatus: input.verdict === 'resolved' ? 'succeeded' : 'failed',
      retryable: false,
    })
    .where(
      and(
        eq(assistantToolCalls.id, id),
        or(
          eq(assistantToolCalls.reconciliationState, 'required'),
          isNull(assistantToolCalls.reconciliationState)
        ),
        sql`${assistantToolCalls.dispatchedAt} IS NOT NULL`
      )
    )
    .returning()
  return row ?? null
}

export interface RecordDeniedToolCallInput {
  conversationId?: ConversationId
  involvementId?: AssistantInvolvementId
  pendingActionId?: AssistantPendingActionId
  toolName: string
  args: Record<string, unknown>
  reason: string
  principalId?: PrincipalId
}

/** Record a denied tool call directly — a denial never attempts its side-effect, so it needs no claim. */
export async function recordDeniedToolCall(
  input: RecordDeniedToolCallInput,
  exec: Executor = db
): Promise<AssistantToolCall> {
  const [row] = await exec
    .insert(assistantToolCalls)
    .values({
      conversationId: input.conversationId ?? null,
      involvementId: input.involvementId ?? null,
      pendingActionId: input.pendingActionId ?? null,
      toolName: input.toolName,
      args: input.args,
      status: 'denied',
      error: input.reason,
      principalId: input.principalId ?? null,
    })
    .returning()
  return row
}

// ---------------------------------------------------------------------------
// Retention cleanup
// ---------------------------------------------------------------------------

/** Mirrors ai_usage_log's PIPELINE_LOG_RETENTION_DAYS (usage-log.ts): a
 *  tool-call audit row is kept twice as long as ai_usage_log's own 90-day
 *  AI_USAGE_RETENTION_DAYS, since it's the audit trail for real side effects
 *  (a refund issued, a conversation closed), not just spend/latency telemetry. */
export const ASSISTANT_TOOL_CALLS_RETENTION_DAYS = 180

/** Same 180-day horizon as the tool-call audit rows: usage events are the
 *  outcome half of the same Copilot report, so both halves of a range query
 *  age out together rather than the outcomes going dark 90 days early. */
export const ASSISTANT_EVENTS_RETENTION_DAYS = 180

/** One sweep body for both exported cleanups below. `table` is a hardcoded
 *  name from those two call sites only (it rides `sql.raw`), never input. */
async function sweepExpired(
  table: 'assistant_tool_calls' | 'assistant_events',
  retentionDays: number,
  label: string,
  exec: Executor
): Promise<{ deleted: number }> {
  const result = await exec.execute(
    sql`DELETE FROM ${sql.raw(table)} WHERE created_at < now() - interval '${sql.raw(String(retentionDays))} days'`
  )
  const deleted = (result as { count: number }).count ?? 0

  if (deleted > 0) {
    log.info({ deleted, retention_days: retentionDays }, `${label} retention cleanup completed`)
  }

  return { deleted }
}

/** Sweep assistant_tool_calls rows past retention. Registered alongside
 *  usage-log.ts's cleanupExpiredLogs on the daily maintenance sweep in
 *  startup.ts (the 'logs_retention' sweep lock). */
export async function cleanupExpiredToolCalls(exec: Executor = db): Promise<{ deleted: number }> {
  return sweepExpired(
    'assistant_tool_calls',
    ASSISTANT_TOOL_CALLS_RETENTION_DAYS,
    'assistant tool call',
    exec
  )
}

/** Sweep assistant_events rows past retention. Registered alongside
 *  cleanupExpiredToolCalls above on the daily maintenance sweep in
 *  startup.ts (the 'logs_retention' sweep lock). */
export async function cleanupExpiredAssistantEvents(
  exec: Executor = db
): Promise<{ deleted: number }> {
  return sweepExpired(
    'assistant_events',
    ASSISTANT_EVENTS_RETENTION_DAYS,
    'assistant usage event',
    exec
  )
}
