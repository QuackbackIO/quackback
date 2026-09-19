/**
 * The reviewed follow-up, and the link that makes one possible
 * (QUINN-PRODUCT P9).
 *
 * Linking is here rather than beside the capture commands because the screen
 * that calls it is the feedback one: a reviewer looking at a capture next to
 * an existing board post decides to attach the evidence rather than merge two
 * posts together, which is a different decision with a different blast radius.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { ConversationId, PostId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { MAX_FOLLOWUP_MESSAGE } from '@/lib/server/domains/posts/post.followup'

/** Who a reviewer would be telling, and what stops each of them. */
export const getPostFollowupAudienceFn = createServerFn({ method: 'GET' })
  .validator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })
    const actor = await policyActorFromAuth(ctx)
    const { getFollowupAudience } = await import('@/lib/server/domains/posts/post.followup')
    return await getFollowupAudience(data.postId as PostId, actor)
  })

/** Send the reviewed update. Never called by anything but a person. */
export const sendPostFollowupFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      postId: z.string(),
      message: z.string().min(1).max(MAX_FOLLOWUP_MESSAGE),
      conversationIds: z.array(z.string()).min(1).max(50),
    })
  )
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.POST_APPROVE })
    const actor = await policyActorFromAuth(ctx)
    const { sendPostFollowup } = await import('@/lib/server/domains/posts/post.followup')
    return await sendPostFollowup(
      {
        postId: data.postId as PostId,
        message: data.message,
        conversationIds: data.conversationIds as ConversationId[],
      },
      actor
    )
  })

/**
 * Attach a conversation to an existing post as evidence.
 *
 * Deliberately not a merge. A merge rolls one post's comments and voters onto
 * another and cannot cross the internal boundary; a link attaches the
 * conversation and casts no vote, which is what "this customer asked for the
 * same thing" actually means.
 */
export const linkConversationToPostFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({ conversationId: z.string(), postId: z.string(), displayId: z.string().optional() })
  )
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.POST_EDIT })
    const { linkConversationToPost } = await import('@/lib/server/domains/posts/post.capture')
    await linkConversationToPost({
      conversationId: data.conversationId as ConversationId,
      postId: data.postId as PostId,
      displayId: data.displayId ?? null,
    })
    return { linked: true }
  })
