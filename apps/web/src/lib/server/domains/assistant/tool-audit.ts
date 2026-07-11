/**
 * Tool-call audit log. `claimToolCall` inserts the `started` row via
 * INSERT ... ON CONFLICT DO NOTHING before any side-effect runs, mirroring
 * claimHookDelivery (events/hook-idempotency.ts): the first writer for a given
 * idempotency key wins the row, and a retried call (BullMQ redelivery, a
 * duplicated LLM turn) gets null back and skips its side-effect. Calls with no
 * stable idempotency key always land — the partial unique index only applies
 * where the key is non-null, so two NULLs never conflict.
 */
import { db, eq, sql, assistantToolCalls } from '@/lib/server/db'
import type { AssistantToolCallStatus } from '@/lib/server/db'
import type {
  AssistantToolCallId,
  AssistantInvolvementId,
  AssistantPendingActionId,
  ConversationId,
  PrincipalId,
} from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-tool-calls-retention' })

export type AssistantToolCall = typeof assistantToolCalls.$inferSelect

export interface ClaimToolCallInput {
  conversationId?: ConversationId
  involvementId?: AssistantInvolvementId
  pendingActionId?: AssistantPendingActionId
  toolName: string
  args: Record<string, unknown>
  idempotencyKey?: string
  principalId?: PrincipalId
}

/** Claim a tool call before running its side-effect. Null means a call already claimed this idempotency key. */
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
      status: 'started',
    })
    .onConflictDoNothing()
    .returning()
  return row ?? null
}

export interface FinalizeToolCallInput {
  status: Extract<AssistantToolCallStatus, 'succeeded' | 'failed' | 'denied'>
  resultSummary?: string
  error?: string
  latencyMs?: number
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
  await exec.update(assistantToolCalls).set(values).where(eq(assistantToolCalls.id, id))
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
 *  usage-log.ts's cleanupExpiredLogs on the same daily BullMQ job
 *  (feedback-ai-queue.ts's 'retention-cleanup' job type). */
export async function cleanupExpiredToolCalls(exec: Executor = db): Promise<{ deleted: number }> {
  return sweepExpired(
    'assistant_tool_calls',
    ASSISTANT_TOOL_CALLS_RETENTION_DAYS,
    'assistant tool call',
    exec
  )
}

/** Sweep assistant_events rows past retention. Registered alongside
 *  cleanupExpiredToolCalls above on the same daily BullMQ job
 *  (feedback-ai-queue.ts's 'retention-cleanup' job type). */
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
