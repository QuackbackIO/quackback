/**
 * Approval bookkeeping for pending actions: who filed one, the risk shown
 * beside it, and the digest of the content a decision binds to.
 *
 * A pending action records who asked (the credential or agent, and the person
 * whose authority it borrows) and the digest of the exact content proposed.
 * A decision names the digest of what the person was shown, and one naming
 * anything else is refused. The status transitions themselves stay
 * compare-and-set updates in pending-actions.service.ts.
 */
import {
  db,
  eq,
  and,
  isNull,
  assistantPendingActions,
  type ApprovalRequestChannel,
  type ApprovalRisk,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { ConflictError } from '@/lib/shared/errors'
import { digestOf } from '@/lib/server/utils/canonical-json'

type PendingActionRow = typeof assistantPendingActions.$inferSelect
type Executor = Database | Transaction

/** The risk of a request filed without one. */
export const DEFAULT_APPROVAL_RISK: ApprovalRisk = 'medium'

/** Who filed a request. Stored on the row; never used to authorize a decision. */
export interface ApprovalRequester {
  via: ApprovalRequestChannel
  /** The principal that filed it: an API key's service principal, the AI assistant, or a person. */
  requestedById?: PrincipalId | null
  /** The person whose authority the request borrows. */
  onBehalfOfPrincipalId?: PrincipalId | null
  /** The API key id or OAuth client id it arrived through. */
  credentialId?: string | null
  clientName?: string | null
}

/** The requester columns of a new pending action. */
export function requesterColumns(requester: ApprovalRequester | undefined) {
  return {
    requestedVia: requester?.via ?? null,
    requestedById: requester?.requestedById ?? null,
    onBehalfOfPrincipalId: requester?.onBehalfOfPrincipalId ?? null,
    credentialId: requester?.credentialId ?? null,
    clientName: requester?.clientName ?? null,
  }
}

/** The longest rejection reason kept. */
const MAX_REASON_LENGTH = 500

/** A rejection reason as stored: trimmed, bounded, and null when blank. */
export function normalizeDecisionReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim()
  return trimmed ? trimmed.slice(0, MAX_REASON_LENGTH) : null
}

/** The digest of a request's content, the value a decision binds to. */
export function approvalContentDigest(args: Record<string, unknown>): string {
  return digestOf(args)
}

/**
 * The digest a decision on this request must name, as shown to a person: the
 * digest of the content being shown.
 *
 * Every request filed now stores one that matches its content. Two kinds of
 * row do not: one filed before digests were kept (none stored), and one an
 * older instance edited in place while merging same-turn requests (a stored
 * digest its content no longer matches, which every decision would refuse
 * until it expired). Either is bound to the content shown now, with a
 * compare-and-set on the value that was read, so the person decides what they
 * see and a decision naming anything else is refused.
 */
async function digestForDisplay(row: PendingActionRow, exec: Executor): Promise<string> {
  const digest = approvalContentDigest(row.args)
  if (row.argsDigest === digest || row.status !== 'proposed') return digest
  await exec
    .update(assistantPendingActions)
    .set({ argsDigest: digest })
    .where(
      and(
        eq(assistantPendingActions.id, row.id),
        row.argsDigest === null
          ? isNull(assistantPendingActions.argsDigest)
          : eq(assistantPendingActions.argsDigest, row.argsDigest)
      )
    )
  // If another reader moved the digest first, the one returned here still
  // names exactly what this reader shows; a decision on it lands only if the
  // stored digest and the content agree with it.
  return digest
}

/** The approval fields a card shows beside a request: the digest to decide on, and the risk. */
export async function approvalFieldsForDisplay(
  row: PendingActionRow,
  exec: Executor = db
): Promise<{ argsDigest: string; risk: ApprovalRisk }> {
  return {
    argsDigest: await digestForDisplay(row, exec),
    risk: row.risk ?? DEFAULT_APPROVAL_RISK,
  }
}

/**
 * Throw unless a decision names the content that was shown and is still
 * stored. A request whose digest was never stored has not been shown, and a
 * stored digest that no longer matches the content means it changed.
 */
export function assertDecisionNamesContent(row: PendingActionRow, contentHash: string): void {
  if (
    !row.argsDigest ||
    contentHash !== row.argsDigest ||
    row.argsDigest !== approvalContentDigest(row.args)
  )
    throw new ConflictError('APPROVAL_CONTENT_CHANGED', 'This request changed. Review it again.')
}
