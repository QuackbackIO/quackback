/**
 * The HTTP retry boundary for the visitor send contract.
 *
 * This is a DIFFERENT boundary from the durable turn. The run gives one outcome
 * per persisted trigger; this gives one persisted trigger per client attempt.
 * Without it, a client that retries a send whose response was lost creates a
 * second message, and a retry of the FIRST send (which carries no conversation
 * id yet) creates a second conversation.
 *
 * Three properties, in the order they matter:
 *
 * 1. The receipt is claimed in the SAME transaction as the message insert. A
 *    claim that committed separately could survive a rolled-back send, and the
 *    retry would then be told "already done" about a message that does not
 *    exist.
 * 2. `ON CONFLICT DO NOTHING` on (principal, mutation id) makes a concurrent
 *    duplicate WAIT for the first transaction rather than racing it. By the
 *    time the loser reads the row, the winner has either committed (so the
 *    identities are there) or rolled back (so the loser's own insert wins).
 * 3. The receipt is bound to a digest of the request. The same key with
 *    different content is a client bug, and answering it with somebody else's
 *    message identities would be worse than refusing.
 *
 * None of this promises transport-level exactly-once, and a client that omits
 * the key keeps working exactly as before.
 */
import { createHash } from 'node:crypto'
import { assistantRequestReceipts, and, eq } from '@/lib/server/db'
import type { Transaction } from '@/lib/server/db'
import type { ConversationId, ConversationMessageId, PrincipalId } from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'

/** Bound so a client cannot use the key as unbounded storage. */
export const MAX_CLIENT_MUTATION_ID_LENGTH = 64

export interface RequestDigestInput {
  conversationId?: string | null
  content: string
  visitorEmail?: string | null
  visitorName?: string | null
  attachmentCount: number
  blockReplyMessageId?: string | null
}

/**
 * A stable digest of what the client asked for.
 *
 * Deliberately narrow: the fields a human would call "the same send". It is not
 * a hash of the whole payload, because a client that retries with a re-ordered
 * attachment array or an added trace header is retrying, not asking for
 * something else.
 */
export function requestDigest(input: RequestDigestInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.conversationId ?? null,
        input.content,
        input.visitorEmail ?? null,
        input.visitorName ?? null,
        input.attachmentCount,
        input.blockReplyMessageId ?? null,
      ])
    )
    .digest('hex')
}

export type RequestReceiptClaim =
  | { kind: 'claimed' }
  | {
      kind: 'replay'
      conversationId: ConversationId | null
      messageId: ConversationMessageId | null
    }

/**
 * Claim the key for this request, or report that it was already used.
 *
 * Throws when the key is reused with different content: a caller that reuses a
 * mutation id for a new send has a bug, and silently accepting it would make
 * the second message disappear.
 */
export async function claimRequestReceipt(
  tx: Transaction,
  input: {
    principalId: PrincipalId
    clientMutationId: string
    digest: string
  }
): Promise<RequestReceiptClaim> {
  const inserted = await tx
    .insert(assistantRequestReceipts)
    .values({
      principalId: input.principalId,
      clientMutationId: input.clientMutationId,
      requestDigest: input.digest,
    })
    .onConflictDoNothing({
      target: [assistantRequestReceipts.principalId, assistantRequestReceipts.clientMutationId],
    })
    .returning({ id: assistantRequestReceipts.id })
  if (inserted.length > 0) return { kind: 'claimed' }

  const [existing] = await tx
    .select()
    .from(assistantRequestReceipts)
    .where(
      and(
        eq(assistantRequestReceipts.principalId, input.principalId),
        eq(assistantRequestReceipts.clientMutationId, input.clientMutationId)
      )
    )
    .limit(1)
  if (!existing) {
    // The winner rolled back between the conflict and this read, so the key is
    // free again. Treat it as ours rather than inventing a replay.
    return { kind: 'claimed' }
  }
  if (existing.requestDigest !== input.digest) {
    throw new ValidationError(
      'CLIENT_MUTATION_ID_REUSED',
      'This request id was already used for different content.'
    )
  }
  return {
    kind: 'replay',
    conversationId: existing.conversationId,
    messageId: existing.messageId,
  }
}

/** Record which conversation and message the claimed key produced. */
export async function completeRequestReceipt(
  tx: Transaction,
  input: {
    principalId: PrincipalId
    clientMutationId: string
    conversationId: ConversationId
    messageId: ConversationMessageId
  }
): Promise<void> {
  await tx
    .update(assistantRequestReceipts)
    .set({ conversationId: input.conversationId, messageId: input.messageId })
    .where(
      and(
        eq(assistantRequestReceipts.principalId, input.principalId),
        eq(assistantRequestReceipts.clientMutationId, input.clientMutationId)
      )
    )
}
