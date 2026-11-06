/**
 * Decision bookkeeping for pending actions: who filed one and the digest of
 * the content a decision binds to.
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
  type Database,
  type Transaction,
} from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { ConflictError } from '@/lib/shared/errors'
import { digestOf } from '@/lib/server/utils/canonical-json'

type PendingActionRow = typeof assistantPendingActions.$inferSelect
type Executor = Database | Transaction

/** Who filed a pending action. Stored on the row; never used to authorize a decision. */
export interface PendingActionRequester {
  /** The principal that filed it: an API key's service principal, the AI assistant, or a person. */
  requestedById?: PrincipalId | null
  /** The person whose authority the request borrows. */
  onBehalfOfPrincipalId?: PrincipalId | null
  /** The API key id or OAuth client id it arrived through. */
  credentialId?: string | null
  clientName?: string | null
}

/** The requester columns of a new pending action. */
export function requesterColumns(requester: PendingActionRequester | undefined) {
  return {
    requestedById: requester?.requestedById ?? null,
    onBehalfOfPrincipalId: requester?.onBehalfOfPrincipalId ?? null,
    credentialId: requester?.credentialId ?? null,
    clientName: requester?.clientName ?? null,
  }
}

/** The digest of a pending action's content, the value a decision binds to. */
export function pendingActionContentDigest(args: Record<string, unknown>): string {
  return digestOf(args)
}

/**
 * The digest a decision on this pending action must name, as shown to a person: the
 * digest of the content being shown.
 *
 * Every pending action filed now stores one that matches its content. Two kinds of
 * row do not: one filed before digests were kept (none stored), and one an
 * older instance edited in place while merging same-turn pending actions (a stored
 * digest its content no longer matches, which every decision would refuse
 * until it expired). Either is bound to the content shown now, with a
 * compare-and-set on the value that was read, so the person decides what they
 * see and a decision naming anything else is refused.
 */
async function digestForDisplay(row: PendingActionRow, exec: Executor): Promise<string> {
  const digest = pendingActionContentDigest(row.args)
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

/** The field a card needs to decide a pending action: the digest to name. */
export async function decisionFieldsForDisplay(
  row: PendingActionRow,
  exec: Executor = db
): Promise<{ argsDigest: string }> {
  return { argsDigest: await digestForDisplay(row, exec) }
}

/**
 * Throw unless a decision names the content that was shown and is still
 * stored. A pending action whose digest was never stored has not been shown, and a
 * stored digest that no longer matches the content means it changed.
 */
export function assertDecisionNamesContent(row: PendingActionRow, contentHash: string): void {
  if (
    !row.argsDigest ||
    contentHash !== row.argsDigest ||
    row.argsDigest !== pendingActionContentDigest(row.args)
  )
    throw new ConflictError('APPROVAL_CONTENT_CHANGED', 'This request changed. Review it again.')
}
