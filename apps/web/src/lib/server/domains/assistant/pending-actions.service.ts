/**
 * Pending actions — a write-tool call Quinn proposed but has not executed,
 * awaiting agent approval within a TTL. Every state change past `proposed` is
 * a conditional UPDATE guarded by the expected prior status (mirrors
 * assistant.involvement's recordOutcome at-most-one guard): two racing
 * callers can never both "win" the same transition, and an UPDATE that
 * matches no row simply returns null instead of throwing.
 */
import { db, eq, and, lt, gt, assistantPendingActions } from '@/lib/server/db'
import type {
  AssistantPendingActionId,
  AssistantInvolvementId,
  ConversationId,
  PrincipalId,
} from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { getAssistantPrincipal } from './assistant.principal'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-pending-actions' })

export type AssistantPendingAction = typeof assistantPendingActions.$inferSelect

/** Default time an unattended proposal stays decidable before the sweep expires it. */
const DEFAULT_TTL_HOURS = 24

export interface ProposePendingActionInput {
  conversationId: ConversationId
  involvementId?: AssistantInvolvementId
  toolName: string
  args: Record<string, unknown>
  summary: string
  ttlHours?: number
  /**
   * A stable per-turn key, same shape as `assistant_tool_calls.idempotency_key`
   * (assistant.tools.ts's `resolveIdempotencyKey`:
   * `conversationId:latestCustomerMessageId:toolName:hash(args)`). A synthesis
   * retry that re-runs the same write-tool call for the same turn mints the
   * identical key, so the INSERT below no-ops against the partial-unique
   * index instead of creating a duplicate row and re-announcing the note; see
   * this function's doc comment and the column comment in the Drizzle schema
   * for why the uniqueness is scoped to `status = 'proposed'`. Undefined
   * never conflicts (a NULL key never collides with another NULL), matching
   * every caller that predates this field.
   */
  idempotencyKey?: string
}

/**
 * Open a proposal awaiting agent approval. When `idempotencyKey` is set and a
 * still-`proposed` row already claimed it (a retried synthesis attempt
 * re-running the same write-tool call within one turn), the INSERT no-ops on
 * the partial-unique index and this returns that EXISTING row instead of
 * inserting a duplicate — the propose-time note (`surfacePendingActionNote`)
 * only ever fires for the row that actually won the insert, never for a
 * deduped retry.
 */
export async function proposePendingAction(
  input: ProposePendingActionInput,
  exec: Executor = db
): Promise<AssistantPendingAction> {
  const ttlHours = input.ttlHours ?? DEFAULT_TTL_HOURS
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000)
  const [row] = await exec
    .insert(assistantPendingActions)
    .values({
      conversationId: input.conversationId,
      involvementId: input.involvementId ?? null,
      toolName: input.toolName,
      args: input.args,
      summary: input.summary,
      expiresAt,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing()
    .returning()
  if (row) {
    await surfacePendingActionNote(row)
    return row
  }
  // Conflict: a NULL key never conflicts (the partial index only covers
  // non-NULL keys), so reaching here with no row guarantees idempotencyKey
  // was set and another still-proposed row already claimed it.
  const existing = await getPendingActionByIdempotencyKey(input.idempotencyKey!, exec)
  if (!existing) {
    // Vanishingly unlikely (the winning row would have to be deleted between
    // the INSERT and this SELECT) but never return a void proposal.
    throw new Error(
      `proposePendingAction: idempotency conflict on "${input.idempotencyKey}" but no existing row was found`
    )
  }
  return existing
}

/** Look up a pending action by its idempotency key — the dedup read
 *  `proposePendingAction` falls back to when its INSERT no-ops on conflict. */
export async function getPendingActionByIdempotencyKey(
  idempotencyKey: string,
  exec: Executor = db
): Promise<AssistantPendingAction | null> {
  const [row] = await exec
    .select()
    .from(assistantPendingActions)
    .where(eq(assistantPendingActions.idempotencyKey, idempotencyKey))
    .limit(1)
  return row ?? null
}

/**
 * Announce a fresh proposal in the inbox thread so the team sees it without
 * polling. Best-effort: a note failure (or Quinn not yet provisioned) must
 * never fail the proposal itself, since the pending action row is already the
 * source of truth an agent can act on from the approval queue.
 */
async function surfacePendingActionNote(row: AssistantPendingAction): Promise<void> {
  try {
    const assistant = await getAssistantPrincipal()
    if (!assistant) return
    const { appendAssistantPendingActionNote } =
      await import('@/lib/server/domains/conversation/conversation.service')
    await appendAssistantPendingActionNote(
      row.conversationId,
      { pendingActionId: row.id, toolName: row.toolName, summary: row.summary },
      { principalId: assistant.id, displayName: assistant.displayName }
    )
  } catch (err) {
    log.warn({ err, pendingActionId: row.id }, 'assistant pending action note failed')
  }
}

/** Load a pending action by id, or null when it does not exist. */
export async function getPendingActionById(
  id: AssistantPendingActionId,
  exec: Executor = db
): Promise<AssistantPendingAction | null> {
  const [row] = await exec
    .select()
    .from(assistantPendingActions)
    .where(eq(assistantPendingActions.id, id))
    .limit(1)
  return row ?? null
}

/**
 * Move a proposal to approved/rejected. Only a still-`proposed`,
 * not-yet-expired action is decidable; returns null otherwise (already
 * decided, or the sweep beat this call to expiring it).
 */
export async function decidePendingAction(
  id: AssistantPendingActionId,
  decision: 'approved' | 'rejected',
  decidedById: PrincipalId,
  exec: Executor = db
): Promise<AssistantPendingAction | null> {
  const [row] = await exec
    .update(assistantPendingActions)
    .set({ status: decision, decidedById, decidedAt: new Date() })
    .where(
      and(
        eq(assistantPendingActions.id, id),
        eq(assistantPendingActions.status, 'proposed'),
        gt(assistantPendingActions.expiresAt, new Date())
      )
    )
    .returning()
  return row ?? null
}

/** Settle an approved action into a terminal execution outcome. */
async function settleApprovedAction(
  id: AssistantPendingActionId,
  status: 'executed' | 'failed',
  result: Record<string, unknown> | null,
  exec: Executor
): Promise<AssistantPendingAction | null> {
  const [row] = await exec
    .update(assistantPendingActions)
    .set({ status, executedAt: new Date(), result })
    .where(and(eq(assistantPendingActions.id, id), eq(assistantPendingActions.status, 'approved')))
    .returning()
  return row ?? null
}

/** Record a successful execution. Only an `approved` action can be executed. */
export async function markPendingActionExecuted(
  id: AssistantPendingActionId,
  result: Record<string, unknown> | null,
  exec: Executor = db
): Promise<AssistantPendingAction | null> {
  return settleApprovedAction(id, 'executed', result, exec)
}

/** Record a failed execution attempt. Only an `approved` action can fail this way. */
export async function markPendingActionFailed(
  id: AssistantPendingActionId,
  error: string,
  exec: Executor = db
): Promise<AssistantPendingAction | null> {
  return settleApprovedAction(id, 'failed', { error }, exec)
}

/**
 * Sweep proposals nobody decided in time. Set-based UPDATE, called from the
 * periodic sweep tick; this just flips the rows and returns them. Pure
 * primitive — `sweepAndNotifyExpiredPendingActions` is what the sweeper
 * actually calls, so the customer notice stays a separate, best-effort step.
 */
export async function expireStalePendingActions(
  exec: Executor = db
): Promise<AssistantPendingAction[]> {
  return exec
    .update(assistantPendingActions)
    .set({ status: 'expired' })
    .where(
      and(
        eq(assistantPendingActions.status, 'proposed'),
        lt(assistantPendingActions.expiresAt, new Date())
      )
    )
    .returning()
}

/**
 * Sweep + announce: expire stale proposals, then drop a customer-visible
 * notice on each affected conversation so nobody is left thinking Quinn is
 * still waiting on a teammate. Called from the periodic sweep tick alongside
 * the other assistant sweeps (snooze-sweep-queue). The notice itself is
 * best-effort inside `emitAssistantActionExpiredSystemMessage` — a publish
 * failure there must not stop the rest of the batch from being announced.
 */
export async function sweepAndNotifyExpiredPendingActions(
  exec: Executor = db
): Promise<AssistantPendingAction[]> {
  const expired = await expireStalePendingActions(exec)
  if (expired.length === 0) return expired
  const { emitAssistantActionExpiredSystemMessage } =
    await import('@/lib/server/domains/conversation/conversation.service')
  await Promise.all(
    expired.map((row) => emitAssistantActionExpiredSystemMessage(row.conversationId))
  )
  return expired
}
