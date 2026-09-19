/**
 * The normalized tool outcome, and the rules a duplicate call is answered by.
 *
 * Two things live here and nothing else: the shape every tool result is
 * adapted into at the wrapper boundary, and the pure decision that turns an
 * existing receipt into the outcome a repeat of the same logical action gets.
 * Both are free of database access so the decision table can be read, and
 * tested, without a fixture.
 *
 * ## Why a fulfilled promise is not evidence
 *
 * A remote tool that answers `{ ok: false }` resolved its promise. A connector
 * whose session died mid-call rejected it. Neither says anything about whether
 * the business effect happened, and the audit row, the prompt and the report
 * all used to read "the promise resolved" as "the action succeeded". The
 * outcome below is the only thing any of them may read now.
 *
 * ## The identity a replay is keyed by
 *
 * Not the model's tool-call id, which is new on every generation, and not the
 * job id, which is new on every attempt. The logical action key is derived
 * from the parent item, the engagement inside it, the tool and the canonical
 * argument digest, so a run continuation that means the same thing computes
 * the same key. Once a human has decided a proposal, the decision itself is
 * the boundary and the key becomes `pending:<id>`.
 *
 * A digest detects drift. It cannot tell two differently worded commands that
 * mean the same business action apart, which is why nothing here treats a
 * digest match as proof of intent: it only ever prevents a second effect.
 */
import { createHash } from 'node:crypto'
import { assistantToolCalls } from '@/lib/server/db'
import type { AssistantToolOutcomeStatus, AssistantToolReplayStrategy } from '@/lib/server/db'

/**
 * One receipt row. Defined here rather than in tool-audit.ts because the
 * decision table below is the thing that reads it, and tool-audit.ts imports
 * this module; it is re-exported from there so every existing caller is
 * unaffected.
 */
export type AssistantToolCall = typeof assistantToolCalls.$inferSelect

/**
 * The internal contract every tool result is adapted into.
 *
 * `unknown` is the one the rest of the system is built around: the effect may
 * have happened, so it is never announced as done and never resent.
 */
export type ToolOutcome =
  | { status: 'succeeded'; value: unknown; receiptId: string }
  | { status: 'denied'; reason: string }
  | { status: 'pending_approval'; actionId: string }
  | { status: 'in_progress'; receiptId: string }
  | { status: 'failed'; reason: string; retryable: boolean }
  | { status: 'unknown'; receiptId: string; reconciliationRequired: true }

/** JSON.stringify with object keys sorted at every depth, so equivalent args hash the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** The canonical digest of a value. Stable across key order and across processes. */
export function digestOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/**
 * The stable logical identity of one business action.
 *
 * `engagement` is what keeps this from being either too narrow or too wide. The
 * customer message id alone is too narrow: a continuation after an approval is
 * a different message and would mint a new key for the same action. The parent
 * alone is too wide: the same tool with the same arguments is a legitimately
 * new action in a later engagement. The involvement, when there is one, is
 * exactly the engagement the action belongs to.
 */
export function logicalActionKey(input: {
  parentKey: string
  engagement: string
  toolName: string
  argsDigest: string
}): string {
  return `${input.parentKey}:${input.engagement}:${input.toolName}:${input.argsDigest}`
}

/** The action key of an approved proposal: the decision is the boundary. */
export function pendingActionKey(pendingActionId: string): string {
  return `pending:${pendingActionId}`
}

/**
 * How far a stored result may be carried back to the model.
 *
 * Bounded on purpose: a replay answer is evidence that the action happened, not
 * a second chance to feed an unbounded provider payload into the prompt.
 */
export const MAX_RECEIPT_RESULT_BYTES = 4096

/** Clamp a tool result to something a receipt may store and a replay may return. */
export function boundedResult(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return null
  let serialized: string
  try {
    serialized = JSON.stringify(value) ?? 'null'
  } catch {
    return { truncated: true, note: 'The result could not be recorded.' }
  }
  if (serialized.length > MAX_RECEIPT_RESULT_BYTES) {
    return { truncated: true, preview: serialized.slice(0, MAX_RECEIPT_RESULT_BYTES) }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { value: value as never }
}

/** Was this receipt's effect already attempted against something outside this database? */
export function wasDispatched(receipt: Pick<AssistantToolCall, 'dispatchedAt'>): boolean {
  return receipt.dispatchedAt !== null
}

/**
 * The duplicate-call table, as one function.
 *
 * | Receipt state | Answer |
 * | --- | --- |
 * | succeeded | the stored result and the receipt id; no second effect |
 * | still executing | a wait; never a completion claim |
 * | definitely failed before dispatch | failed, retryable only under the tool's own safe policy |
 * | dispatched, outcome unknown | unknown, reconciliation required; never resent |
 * | denied / expired / cancelled | that disposition, preserved |
 *
 * The dispatched-with-no-settlement case is read from the stamps rather than
 * from a status word, because that is the state a crash leaves behind: nobody
 * was alive to write the word.
 */
export function replayOutcomeFor(receipt: AssistantToolCall): ToolOutcome {
  const receiptId = receipt.id
  if (receipt.outcomeStatus === 'succeeded' || receipt.status === 'succeeded') {
    return { status: 'succeeded', value: receipt.result ?? { recorded: true }, receiptId }
  }
  if (receipt.outcomeStatus === 'denied' || receipt.status === 'denied') {
    return { status: 'denied', reason: receipt.error ?? 'This action was refused.' }
  }
  if (receipt.outcomeStatus === 'unknown' || receipt.reconciliationState === 'required') {
    return { status: 'unknown', receiptId, reconciliationRequired: true }
  }
  // A crash between the dispatch and the settlement leaves exactly this: an
  // attempted external effect nobody ever wrote an outcome for.
  if (wasDispatched(receipt) && receipt.settledAt === null && receipt.status === 'started') {
    return { status: 'unknown', receiptId, reconciliationRequired: true }
  }
  if (receipt.outcomeStatus === 'failed' || receipt.status === 'failed') {
    return {
      status: 'failed',
      reason: receipt.error ?? 'The previous attempt failed.',
      // Only a failure that is known to precede the dispatch may be retried,
      // and only when the tool itself said a repeat is safe.
      retryable: receipt.retryable === true && !wasDispatched(receipt),
    }
  }
  if (receipt.outcomeStatus === 'pending_approval') {
    return { status: 'pending_approval', actionId: receipt.pendingActionId ?? receiptId }
  }
  // 'started' with nothing dispatched: somebody else owns this action and is
  // still working. A wait, never a completion.
  return { status: 'in_progress', receiptId }
}

/** The receipt columns an outcome settles into. */
export interface OutcomeSettlement {
  /**
   * The coarse column. `started` is deliberate for an unknown outcome: it is
   * the value a crash would have left, and it is the only one of the five that
   * does not assert something the system cannot know.
   */
  status: 'started' | 'succeeded' | 'failed' | 'denied'
  outcomeStatus: AssistantToolOutcomeStatus
  reconciliationState: 'required' | null
  retryable: boolean | null
  error: string | null
}

/**
 * Project an outcome onto the receipt's two status columns.
 *
 * The coarse `status` never gains a value, so a reader that predates the
 * outcome column keeps working: an unknown outcome is not a success there, and
 * the only honest coarse answer for it is the one a crash would have left.
 */
export function settlementFor(outcome: ToolOutcome): OutcomeSettlement | null {
  switch (outcome.status) {
    case 'succeeded':
      return {
        status: 'succeeded',
        outcomeStatus: 'succeeded',
        reconciliationState: null,
        retryable: null,
        error: null,
      }
    case 'failed':
      return {
        status: 'failed',
        outcomeStatus: 'failed',
        reconciliationState: null,
        retryable: outcome.retryable,
        error: outcome.reason,
      }
    case 'denied':
      return {
        status: 'denied',
        outcomeStatus: 'denied',
        reconciliationState: null,
        retryable: null,
        error: outcome.reason,
      }
    case 'unknown':
      // Deliberately NOT 'failed': a failed row invites a retry, and this is
      // the one state from which a retry could repeat a real effect.
      return {
        status: 'started',
        outcomeStatus: 'unknown',
        reconciliationState: 'required',
        retryable: false,
        error: 'The provider did not confirm this action.',
      }
    default:
      return null
  }
}

/**
 * What an interrupted dispatch of this tool becomes.
 *
 * A local mutation commits with its receipt, so there is no window: an
 * interruption leaves neither. An external one has a window, and without a
 * provider idempotency or status-query contract the only truthful answer is
 * `unknown`.
 */
export function outcomeForInterruptedDispatch(
  strategy: AssistantToolReplayStrategy,
  receiptId: string,
  reason: string
): ToolOutcome {
  if (strategy === 'local_transactional') return { status: 'failed', reason, retryable: true }
  return { status: 'unknown', receiptId, reconciliationRequired: true }
}

/** Model-facing notes. Short, and never a completion claim for an unconfirmed effect. */
export const OUTCOME_NOTES: Record<ToolOutcome['status'], string> = {
  succeeded: 'This action completed.',
  denied: 'This action is not permitted for the assistant.',
  pending_approval: 'A teammate must approve this action; tell the customer it has been requested.',
  in_progress: 'This action is already running. Do not claim it finished; say it is in progress.',
  failed: 'This action could not be completed.',
  unknown:
    'This action was sent but not confirmed. Do not claim it completed and do not try it again; a teammate has been asked to check it.',
}
