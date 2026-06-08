/**
 * Card-in-chat sends. An agent can drop a rich "card" into a conversation:
 *   - sharePost: an embedded reference to an existing post (post_ref card) the
 *     visitor can view and upvote.
 *
 * It mirrors sendAgentMessage — server-decided 'agent' sender, conversation
 * touch + assignment claim, realtime broadcast, and the message.created webhook —
 * but stashes the card under metadata.card so it flows through to the DTO.
 *
 * suggestPost is the agent-only sibling: instead of a visitor-facing card, it
 * leaves an INTERNAL note nudging the team to track a resolved conversation as a
 * post — never broadcast to the visitor.
 *
 * upvotePostFromChat is the visitor-side action on a shared post_ref card.
 */
import { db, conversations, chatMessages, eq } from '@/lib/server/db'
import type { ConversationId, PostId, BoardId, PrincipalId, ChatMessageId } from '@quackback/ids'
import type { ChatCard } from '@/lib/shared/db-types'
import type { AgentChatMessageDTO } from '@/lib/shared/chat/types'
import type { Actor } from '@/lib/server/policy/types'
import { canActAsAgent } from '@/lib/server/policy/chat'
import { config } from '@/lib/server/config'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { toMessageDTO, resolveAuthor, conversationToDTO } from './chat.query'
import {
  publishChatEvent,
  publishConversationUpdate,
  publishAgentChatEvent,
} from '@/lib/server/realtime/chat-channels'
import { emitMessageCreated } from './chat.webhooks'
import { addVoteOnBehalf } from '@/lib/server/domains/posts/post.voting'
import type { ChatAuthorInput, SendAgentMessageResult } from './chat.types'

export interface CardAgentCtx {
  agentActor: Actor
  agentPrincipalId: PrincipalId
  agent: ChatAuthorInput
}

/**
 * Insert a card-carrying agent message + touch the conversation in one
 * transaction, then broadcast it. Agent-gated like every other agent write.
 */
async function insertCardMessage(
  conversationId: ConversationId,
  content: string,
  card: ChatCard,
  ctx: CardAgentCtx
): Promise<SendAgentMessageResult> {
  const decision = canActAsAgent(ctx.agentActor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)

  const txResult = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)
    if (!existing) {
      throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
    }

    const [message] = await tx
      .insert(chatMessages)
      .values({
        conversationId,
        principalId: ctx.agent.principalId,
        senderType: 'agent',
        content,
        metadata: { card },
      })
      .returning()

    const [updated] = await tx
      .update(conversations)
      .set({
        lastMessageAt: message.createdAt,
        lastMessagePreview: content,
        // Posting a card claims the conversation if it's still unassigned.
        assignedAgentPrincipalId: existing.assignedAgentPrincipalId ?? ctx.agent.principalId,
        updatedAt: message.createdAt,
      })
      .where(eq(conversations.id, conversationId))
      .returning()

    return { message, conversation: updated }
  })

  const messageDTO = toMessageDTO(txResult.message, await resolveAuthor(ctx.agent))
  // Agent-side DTO so the inbox keeps agent-only fields; publishConversationUpdate
  // strips them from the visitor's copy.
  const conversationDTO = await conversationToDTO(txResult.conversation, 'agent')

  publishConversationUpdate(conversationDTO.id, conversationDTO)
  publishChatEvent(messageDTO.conversationId, {
    kind: 'message',
    conversationId: messageDTO.conversationId,
    message: messageDTO,
  })

  void emitMessageCreated(ctx.agentActor, ctx.agent, txResult.message, txResult.conversation)

  return { conversation: conversationDTO, message: messageDTO }
}

/** Drop a post_ref card (an embedded existing post) into the conversation. */
export function dropPostRefCard(
  conversationId: ConversationId,
  postId: PostId,
  content: string,
  ctx: CardAgentCtx
): Promise<SendAgentMessageResult> {
  const card: ChatCard = { type: 'post_ref', postId }
  return insertCardMessage(conversationId, content, card, ctx)
}

/** Agent shares (embeds) an existing post into the conversation. */
export function sharePost(
  input: { conversationId: ConversationId; postId: PostId },
  ctx: CardAgentCtx
): Promise<SendAgentMessageResult> {
  return dropPostRefCard(input.conversationId, input.postId, `🔼 Shared a related idea`, ctx)
}

/**
 * Agent-only nudge: suggest the SUPPORT TEAM track a RESOLVED conversation as a
 * feedback post. Persisted as an INTERNAL note (isInternal=true) carrying the
 * suggestion under metadata.postSuggestion, and broadcast on the inbox channel
 * ONLY (publishAgentChatEvent) — so it NEVER reaches the visitor and never bumps
 * the visitor-facing last-message preview. Rejected unless the conversation is
 * resolved (closed); a team member confirms the suggestion with one click.
 */
export async function suggestPost(
  input: { conversationId: ConversationId; boardId: BoardId; title: string; content: string },
  ctx: CardAgentCtx
): Promise<{ messageId: ChatMessageId }> {
  const decision = canActAsAgent(ctx.agentActor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)

  const title = input.title.trim()
  const postSuggestion = { boardId: input.boardId, title, content: input.content }

  const message = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1)
    if (!existing) {
      throw new NotFoundError('CONVERSATION_NOT_FOUND', 'Conversation not found')
    }
    // Only nudge the team once the conversation has actually been resolved.
    if (existing.status !== 'closed') {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'Conversation must be resolved before suggesting a post'
      )
    }

    const [inserted] = await tx
      .insert(chatMessages)
      .values({
        conversationId: input.conversationId,
        principalId: ctx.agent.principalId,
        senderType: 'agent',
        isInternal: true,
        content: `💡 Suggested: track this as a feedback post — "${title}"`,
        metadata: { postSuggestion },
      })
      .returning()

    // Internal notes only touch updatedAt — they never change the visitor-facing
    // last-message preview/time.
    await tx
      .update(conversations)
      .set({ updatedAt: inserted.createdAt })
      .where(eq(conversations.id, input.conversationId))

    return inserted
  })

  // Hand-build the agent DTO (a fresh note has no reactions/flags/card) so the
  // realtime payload carries the agent-only suggestion. Inbox channel ONLY — the
  // visitor's conversation channel never receives it.
  const base = toMessageDTO(message, await resolveAuthor(ctx.agent))
  const messageDTO: AgentChatMessageDTO = {
    ...base,
    reactions: [],
    flaggedAt: null,
    cardView: null,
    postSuggestion,
  }
  publishAgentChatEvent({
    kind: 'message',
    conversationId: input.conversationId,
    message: messageDTO,
  })

  return { messageId: message.id }
}

/**
 * Load a card-carrying message and assert the caller owns the conversation it
 * belongs to. The visitor-owns-conversation check is the security boundary for
 * the visitor-initiated card actions below — never relax it.
 */
async function loadOwnedCardMessage(messageId: ChatMessageId, visitorActor: Actor) {
  const [message] = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .limit(1)
  if (!message) throw new NotFoundError('MESSAGE_NOT_FOUND', 'Message not found')

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, message.conversationId))
    .limit(1)
  if (!conversation || conversation.visitorPrincipalId !== visitorActor.principalId) {
    throw new ForbiddenError('FORBIDDEN', 'Not your conversation')
  }
  return { message, conversation }
}

/**
 * Visitor upvotes an embedded post from chat. Reuses addVoteOnBehalf to vote as
 * the conversation's visitor (idempotent insert), attributed to the live-chat
 * source so the post links back to the inbox conversation.
 */
export async function upvotePostFromChat(
  input: { messageId: ChatMessageId; postId: PostId },
  visitorActor: Actor
): Promise<{ voteCount: number }> {
  const { conversation } = await loadOwnedCardMessage(input.messageId, visitorActor)
  const externalUrl = `${config.baseUrl.replace(/\/$/, '')}/admin/inbox?c=${conversation.id}`
  const res = await addVoteOnBehalf(
    input.postId,
    conversation.visitorPrincipalId,
    { type: 'live_chat', externalUrl },
    null,
    visitorActor.principalId ?? undefined
  )
  return { voteCount: res.voteCount }
}
