/**
 * Agent-only, per-message actions in the support inbox: emoji reactions and the
 * team-wide flag. Both are invisible to the visitor — they live in their own
 * tables (so they never appear in a `conversationMessages` select), they are gated to
 * team members, and the realtime update they emit (`message_updated`) is
 * published on the inbox channel ONLY, never the visitor's conversation channel.
 */
import {
  db,
  eq,
  and,
  conversationMessages,
  conversationMessageReactions,
  conversationMessageFlags,
  type ConversationMessage,
} from '@/lib/server/db'
import type { ConversationMessageId, PrincipalId } from '@quackback/ids'
import { NotFoundError, ForbiddenError } from '@/lib/shared/errors'
import { canActAsAgent } from '@/lib/server/policy/chat'
import type { Actor } from '@/lib/server/policy/types'
import { publishAgentChatEvent } from '@/lib/server/realtime/chat-channels'
import { loadAuthors, fallbackAuthor, toMessageDTO, enrichMessageForAgent } from './chat.query'
import type { MessageReactionCount } from '@/lib/shared/chat/types'

/** Resolve the acting agent's principal id, or refuse. Mirrors the gate used by
 *  every other agent-side chat service (sendAgentMessage, assign, …). */
function requireAgent(actor: Actor): PrincipalId {
  const decision = canActAsAgent(actor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)
  if (!actor.principalId) throw new ForbiddenError('FORBIDDEN', 'Agent principal required')
  return actor.principalId
}

/** Load a message that an agent may react to / flag: it must exist, not be
 *  soft-deleted, and not be a system event (status notices aren't content). */
async function loadActionableMessageOr404(
  messageId: ConversationMessageId
): Promise<ConversationMessage> {
  const [message] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
    .limit(1)
  if (!message || message.deletedAt) {
    throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')
  }
  if (message.senderType === 'system') {
    throw new ForbiddenError('FORBIDDEN', 'System messages cannot be reacted to or flagged')
  }
  return message
}

/** Rebuild the enriched agent DTO for a message and fan it out to the inbox
 *  channel only (never the visitor) so every agent's open thread updates live. */
async function publishMessageUpdated(
  message: ConversationMessage,
  viewerPrincipalId: PrincipalId
): Promise<{ reactions: MessageReactionCount[]; flaggedAt: string | null }> {
  const author = message.principalId
    ? ((await loadAuthors([message.principalId])).get(message.principalId) ??
      fallbackAuthor(message.principalId))
    : null
  // Thread the in-memory suggestion off the raw row so a reaction/flag toggle on a
  // suggestion note keeps carrying it in the broadcast (no re-read of metadata).
  const enriched = await enrichMessageForAgent(
    toMessageDTO(message, author),
    viewerPrincipalId,
    message.metadata?.postSuggestion ?? null
  )
  publishAgentChatEvent({
    kind: 'message_updated',
    conversationId: message.conversationId,
    message: enriched,
  })
  return { reactions: enriched.reactions, flaggedAt: enriched.flaggedAt }
}

/** Add an emoji reaction (idempotent via the unique index). */
export async function addMessageReaction(
  messageId: ConversationMessageId,
  emoji: string,
  actor: Actor
): Promise<{ reactions: MessageReactionCount[] }> {
  const agentId = requireAgent(actor)
  const message = await loadActionableMessageOr404(messageId)
  await db
    .insert(conversationMessageReactions)
    .values({ conversationMessageId: messageId, principalId: agentId, emoji })
    .onConflictDoNothing()
  const { reactions } = await publishMessageUpdated(message, agentId)
  return { reactions }
}

/** Remove the actor's own reaction (idempotent — a no-op if absent). */
export async function removeMessageReaction(
  messageId: ConversationMessageId,
  emoji: string,
  actor: Actor
): Promise<{ reactions: MessageReactionCount[] }> {
  const agentId = requireAgent(actor)
  const message = await loadActionableMessageOr404(messageId)
  await db
    .delete(conversationMessageReactions)
    .where(
      and(
        eq(conversationMessageReactions.conversationMessageId, messageId),
        eq(conversationMessageReactions.principalId, agentId),
        eq(conversationMessageReactions.emoji, emoji)
      )
    )
  const { reactions } = await publishMessageUpdated(message, agentId)
  return { reactions }
}

/**
 * Set the caller's personal "Saved for later" flag on a message. Per-agent (one
 * row per (message, agent)), so it's private triage — it does NOT broadcast,
 * since no other agent's view changes. The acting client updates optimistically
 * from the returned flag state.
 */
export async function setMessageFlag(
  messageId: ConversationMessageId,
  flagged: boolean,
  actor: Actor
): Promise<{ flaggedAt: string | null }> {
  const agentId = requireAgent(actor)
  await loadActionableMessageOr404(messageId)
  if (flagged) {
    await db
      .insert(conversationMessageFlags)
      .values({ conversationMessageId: messageId, principalId: agentId })
      .onConflictDoNothing()
  } else {
    await db
      .delete(conversationMessageFlags)
      .where(
        and(
          eq(conversationMessageFlags.conversationMessageId, messageId),
          eq(conversationMessageFlags.principalId, agentId)
        )
      )
  }
  const [flag] = await db
    .select({ flaggedAt: conversationMessageFlags.flaggedAt })
    .from(conversationMessageFlags)
    .where(
      and(
        eq(conversationMessageFlags.conversationMessageId, messageId),
        eq(conversationMessageFlags.principalId, agentId)
      )
    )
    .limit(1)
  return { flaggedAt: flag ? flag.flaggedAt.toISOString() : null }
}
