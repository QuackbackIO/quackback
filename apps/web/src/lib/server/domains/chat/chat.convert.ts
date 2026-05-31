/**
 * Turn a live-chat conversation into a feedback post — the feedback-platform
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
import { assertConversationViewable } from './chat.service'

export interface ConvertChatToPostInput {
  conversationId: ConversationId
  boardId: BoardId
  title?: string
  content?: string
  /** When set, upvote this existing post on the visitor's behalf instead of creating one. */
  asUpvoteOfPostId?: PostId
}

export interface ConvertChatToPostResult {
  postId: PostId
  created: boolean
  boardSlug: string | null
}

export async function convertConversationToPost(
  input: ConvertChatToPostInput,
  ctx: { agentActor: Actor; agentPrincipalId: PrincipalId }
): Promise<ConvertChatToPostResult> {
  const decision = canActAsAgent(ctx.agentActor)
  if (!decision.allowed) throw new ForbiddenError('FORBIDDEN', decision.reason)

  const conversation = await assertConversationViewable(input.conversationId, ctx.agentActor)
  const visitorPrincipalId = conversation.visitorPrincipalId
  const externalUrl = `${config.baseUrl.replace(/\/$/, '')}/admin/chat?conversation=${input.conversationId}`

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

  return { postId, created, boardSlug }
}
