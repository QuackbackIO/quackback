/**
 * Turn a support-inbox conversation into a feedback post — the feedback-platform
 * differentiator. An agent either creates a new post attributed to the VISITOR
 * (so the loop closes back to them) or upvotes an existing post on the
 * visitor's behalf (AI dedupe surfaces candidates in the UI). The conversation
 * is linked to the post via post_external_links for traceability.
 */
import { db, postExternalLinks } from '@/lib/server/db'
import type { ConversationId, PostId, BoardId, PrincipalId } from '@quackback/ids'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'
import { config } from '@/lib/server/config'
import type { Actor } from '@/lib/server/policy/types'
import { canActAsAgent } from '@/lib/server/policy/chat'
import { assertConversationViewable } from './conversation.service'
import type { ChatAuthorInput } from './conversation.types'

export interface ConvertChatToPostInput {
  conversationId: ConversationId
  boardId: BoardId
  title?: string
  content?: string
  /** When set, upvote this existing post on the visitor's behalf instead of creating one. */
  asUpvoteOfPostId?: PostId
  /** Verbatim message text from the visitor — attached as a private team-only comment on the
   *  upvoted post so the original context is never lost. Only used on the upvote path. */
  sourceMessageContent?: string
}

export interface ConvertChatToPostResult {
  postId: PostId
  created: boolean
  boardSlug: string | null
}

export async function createPostFromConversation(
  input: ConvertChatToPostInput,
  ctx: { agentActor: Actor; agentPrincipalId: PrincipalId; agent: ChatAuthorInput }
): Promise<ConvertChatToPostResult> {
  const decision = canActAsAgent(ctx.agentActor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)

  const conversation = await assertConversationViewable(input.conversationId, ctx.agentActor)
  const visitorPrincipalId = conversation.visitorPrincipalId
  const externalUrl = `${config.baseUrl.replace(/\/$/, '')}/admin/inbox?c=${input.conversationId}`

  let postId: PostId
  let created: boolean
  let boardSlug: string | null = null

  if (input.asUpvoteOfPostId) {
    const { addVoteOnBehalf } = await import('@/lib/server/domains/posts/post.voting')
    await addVoteOnBehalf(
      input.asUpvoteOfPostId,
      visitorPrincipalId,
      { type: 'live_chat', externalUrl },
      null,
      ctx.agentPrincipalId
    )
    if (input.sourceMessageContent?.trim()) {
      const { createComment } = await import('@/lib/server/domains/comments/comment.service')
      await createComment(
        {
          postId: input.asUpvoteOfPostId,
          content: `Tracked from a support conversation:\n\n${input.sourceMessageContent.trim()}`,
          isPrivate: true,
        },
        {
          principalId: ctx.agentPrincipalId,
          role: ctx.agentActor.role as 'admin' | 'member',
          name: ctx.agent.displayName ?? undefined,
          email: ctx.agent.email ?? undefined,
        },
        ctx.agentActor
      )
    }
    postId = input.asUpvoteOfPostId
    created = false
  } else {
    const title = input.title?.trim()
    if (!title) throw new ValidationError('VALIDATION_ERROR', 'A title is required')
    const { createPost } = await import('@/lib/server/domains/posts/post.service')
    // Attribute the post to the visitor; the agent actor satisfies the
    // moderation gate (team bypasses approval). createPost auto-subscribes and
    // auto-upvotes the author (the visitor).
    const result = await createPost(
      {
        boardId: input.boardId,
        title,
        content: input.content,
        widgetMetadata: { source: 'live_chat', conversationId: input.conversationId },
        trackedByPrincipalId: ctx.agentPrincipalId,
      },
      { principalId: visitorPrincipalId, actor: ctx.agentActor }
    )
    postId = result.id
    boardSlug = result.boardSlug
    created = true
  }

  // Durable conversation -> post link (idempotent on the unique external-link key).
  await db
    .insert(postExternalLinks)
    .values({
      postId,
      integrationType: 'live_chat',
      externalId: input.conversationId,
      externalUrl,
      externalDisplayId: conversation.subject ?? null,
    })
    .onConflictDoNothing()

  // Confirmation embed to the customer thread so they can follow/upvote the post.
  // The embed resolver viewer-scopes the card's content at render time, so a post
  // the visitor can't see degrades to "unavailable" — no gated content leaks.
  const { sendAgentMessage } = await import('./conversation.service')
  const { postEmbedDoc } = await import('./conversation.cards')
  await sendAgentMessage(
    input.conversationId,
    '',
    ctx.agent,
    ctx.agentActor,
    undefined,
    postEmbedDoc(postId)
  )

  return { postId, created, boardSlug }
}
