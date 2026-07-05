/**
 * Tool-call audit log. `claimToolCall` inserts the `started` row via
 * INSERT ... ON CONFLICT DO NOTHING before any side-effect runs, mirroring
 * claimHookDelivery (events/hook-idempotency.ts): the first writer for a given
 * idempotency key wins the row, and a retried call (BullMQ redelivery, a
 * duplicated LLM turn) gets null back and skips its side-effect. Calls with no
 * stable idempotency key always land — the partial unique index only applies
 * where the key is non-null, so two NULLs never conflict.
 */
import { db, eq, assistantToolCalls } from '@/lib/server/db'
import type { AssistantToolCallStatus } from '@/lib/server/db'
import type {
  AssistantToolCallId,
  AssistantInvolvementId,
  AssistantPendingActionId,
  ConversationId,
  PrincipalId,
} from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'

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
