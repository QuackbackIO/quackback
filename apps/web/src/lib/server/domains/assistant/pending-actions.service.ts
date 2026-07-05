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
}

/** Open a proposal awaiting agent approval. */
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
    })
    .returning()
  return row
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
 * periodic sweep tick (the sweeper's system message + wiring is a later
 * task); this just flips the rows and returns them.
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
