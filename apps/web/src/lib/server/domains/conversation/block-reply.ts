/**
 * Structured customer replies to a conversational block (Phase C, slice C-1).
 * `resolveBlockReply` is the pure decision: given the block message the reply
 * claims to answer (or null) and whether it's already been answered, derive
 * the canonical echo + the metadata.blockReply to store, or null to degrade
 * to an ordinary free-text message. The server NEVER trusts the client's
 * display text — the echo (a button's label, a csat face, ...) is always
 * re-derived from the block's OWN stored config, never from what the client
 * sent alongside the structured answer.
 *
 * Three ways a reply degrades to plain text (contract: "An invalid/stale/
 * second reply degrades to an ordinary free-text message, never an error"):
 *   - invalid: the referenced message doesn't exist, isn't an agent-authored
 *     block, isn't the SAME interactive kind as the reply claims, or the
 *     answer itself doesn't validate against the block's own config (an
 *     unknown buttonKey, an empty collect value, an out-of-range rating).
 *   - stale / second: `alreadyAnswered` is true — some earlier visitor
 *     message in this conversation already carries a blockReply for this
 *     exact `inReplyToMessageId`. A losing double-tap (the run's atomic
 *     waiting->running claim is the true arbiter of which one "won"; this is
 *     a best-effort message-level check, not the authoritative source of
 *     truth) lands here the same way a stale one does.
 *
 * `sendVisitorMessage` (conversation.service.ts) does the DB lookups (the
 * referenced message, the already-answered check) and calls this; this
 * module stays DB-free so the echo/validation rules unit-test without a
 * fixture.
 */
import type {
  ConversationMessage,
  ConversationMessageMetadata,
  WorkflowBlockPayload,
} from '@/lib/server/db'
import { CSAT_FACES } from '@/lib/server/db'

/** The client-supplied structured answer, validated by sendMessageSchema's
 *  blockReply union. Mirrors WorkflowBlockPayload's kind vocabulary exactly
 *  (minus 'message'/'replyTime', which are SEND kinds no reply ever targets). */
export type BlockReplyInput =
  | { kind: 'buttons'; inReplyToMessageId: string; buttonKey: string }
  | { kind: 'collect'; inReplyToMessageId: string; value: string | number | boolean }
  | { kind: 'collectReply'; inReplyToMessageId: string; value: string }
  | { kind: 'csat'; inReplyToMessageId: string; rating: number; comment?: string }

export interface ResolvedBlockReply {
  /** The canonical echo — what renders as this visitor message's `content`. */
  content: string
  /** Merged onto the stored message's `metadata` alongside anything else
   *  already there (there never is anything else on a fresh visitor send,
   *  but this keeps the shape uniform with every other metadata write). */
  metadata: ConversationMessageMetadata
}

/** The subset of a message row resolveBlockReply needs — satisfied by a
 *  narrow column select, not a full ConversationMessage. */
export type BlockMessageRef = Pick<ConversationMessage, 'id' | 'senderType' | 'metadata'>

export function resolveBlockReply(
  blockMessage: BlockMessageRef | null,
  alreadyAnswered: boolean,
  input: BlockReplyInput
): ResolvedBlockReply | null {
  if (!blockMessage || blockMessage.senderType !== 'agent') return null
  if (alreadyAnswered) return null
  const block = blockMessage.metadata?.block
  if (!block || block.kind !== input.kind) return null

  const blockMessageId = blockMessage.id as unknown as string

  switch (input.kind) {
    case 'buttons': {
      const b = block as Extract<WorkflowBlockPayload, { kind: 'buttons' }>
      const option = b.options.find((o) => o.key === input.buttonKey)
      if (!option) return null
      return {
        content: option.label,
        metadata: {
          blockReply: {
            kind: 'buttons',
            inReplyToMessageId: blockMessageId,
            buttonKey: option.key,
          },
        },
      }
    }
    case 'collect': {
      const b = block as Extract<WorkflowBlockPayload, { kind: 'collect' }>
      if (input.value === undefined || input.value === null || input.value === '') return null
      let content: string
      if (b.fieldType === 'select') {
        const option = b.options?.find((o) => o.id === input.value)
        if (!option) return null
        content = option.label
      } else {
        content = String(input.value)
      }
      return {
        content,
        metadata: {
          blockReply: { kind: 'collect', inReplyToMessageId: blockMessageId, value: input.value },
        },
      }
    }
    case 'collectReply': {
      if (typeof input.value !== 'string' || !input.value.trim()) return null
      const value = input.value.trim()
      return {
        content: value,
        metadata: {
          blockReply: { kind: 'collectReply', inReplyToMessageId: blockMessageId, value },
        },
      }
    }
    case 'csat': {
      if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) return null
      const comment = input.comment?.trim() || undefined
      const content = [CSAT_FACES[input.rating - 1], comment].filter(Boolean).join('\n')
      return {
        content,
        metadata: {
          blockReply: {
            kind: 'csat',
            inReplyToMessageId: blockMessageId,
            rating: input.rating,
            ...(comment ? { comment } : {}),
          },
        },
      }
    }
  }
}
