/**
 * In-conversation card sends. An agent can surface existing content inside a conversation:
 *   - sharePost: send an agent message whose body is a quackbackEmbed of the post,
 *     which renders the live embed card the visitor can view and upvote.
 *
 * suggestPost is the agent-only sibling: instead of a visitor-facing embed, it
 * leaves an INTERNAL note nudging the team to track a resolved conversation as a
 * post — never broadcast to the visitor.
 */
import { db, conversations, conversationMessages, eq } from '@/lib/server/db'
import type {
  ConversationId,
  PostId,
  BoardId,
  PrincipalId,
  ConversationMessageId,
} from '@quackback/ids'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy/types'
import { canActAsAgent } from '@/lib/server/policy/conversation'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { toMessageDTO, resolveAuthor, enrichMessageForAgent } from './conversation.query'
import { publishAgentConversationEvent } from '@/lib/server/realtime/conversation-channels'
import type { ConversationAuthorInput, SendAgentMessageResult } from './conversation.types'

export interface CardAgentCtx {
  agentActor: Actor
  agentPrincipalId: PrincipalId
  agent: ConversationAuthorInput
}

/** Embed doc for a feedback post — a single-node doc carrying a quackbackEmbed.
 *  Renders the live embed card on every display surface (inbox + widget)
 *  via the shared embed hydration. */
export function postEmbedDoc(postId: PostId): TiptapContent {
  return { type: 'doc', content: [{ type: 'quackbackEmbed', attrs: { kind: 'post', id: postId } }] }
}

/**
 * Agent shares (embeds) an existing post into the conversation. Sends an
 * embed-only agent message: the empty text is valid because the doc carries a
 * quackbackEmbed node (richMessageFallbackLabel backs the preview), and the embed
 * resolver viewer-scopes the card at render time, so a post the visitor can't see
 * degrades to "unavailable" — no gated content leaks.
 */
export async function sharePost(
  input: { conversationId: ConversationId; postId: PostId },
  ctx: CardAgentCtx
): Promise<SendAgentMessageResult> {
  const { sendAgentMessage } = await import('./conversation.service')
  return sendAgentMessage(
    input.conversationId,
    '',
    ctx.agent,
    ctx.agentActor,
    undefined,
    postEmbedDoc(input.postId)
  )
}

/**
 * Agent-only nudge: suggest the SUPPORT TEAM track a RESOLVED conversation as a
 * feedback post. Persisted as an INTERNAL note (isInternal=true) carrying the
 * suggestion under metadata.postSuggestion, and broadcast on the inbox channel
 * ONLY (publishAgentConversationEvent) — so it NEVER reaches the visitor and never bumps
 * the visitor-facing last-message preview. Rejected unless the conversation is
 * resolved (closed); a team member confirms the suggestion with one click.
 */
export async function suggestPost(
  input: { conversationId: ConversationId; boardId: BoardId; title: string; content: string },
  ctx: CardAgentCtx
): Promise<{ messageId: ConversationMessageId }> {
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
      .insert(conversationMessages)
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

  // Build the agent DTO through the shared enrichment so the agent-only field set
  // lives in exactly one place. The suggestion is threaded in-memory (it's the
  // same payload we just persisted — no re-read); a fresh note has no
  // reactions/flags. Inbox channel ONLY — the visitor's conversation channel
  // never receives it.
  const base = toMessageDTO(message, await resolveAuthor(ctx.agent))
  const messageDTO = await enrichMessageForAgent(base, ctx.agent.principalId, postSuggestion)
  publishAgentConversationEvent({
    kind: 'message',
    conversationId: input.conversationId,
    message: messageDTO,
  })

  return { messageId: message.id }
}
