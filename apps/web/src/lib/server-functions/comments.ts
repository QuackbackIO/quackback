/**
 * Server functions for comment operations
 *
 * NOTE: All service imports are done dynamically inside handlers
 * to prevent client bundling issues with TanStack Start.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type CommentId, type PostId, type UserId } from '@quackback/ids'

const tiptapContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.any()).optional(),
})

const createCommentSchema = z.object({
  postId: z.string(),
  content: z.string().min(1).max(10000),
  contentJson: tiptapContentSchema.optional(),
  parentId: z.string().optional(),
})

const updateCommentSchema = z.object({
  id: z.string(),
  content: z.string().min(1).max(10000),
  contentJson: tiptapContentSchema.optional(),
})

const deleteCommentSchema = z.object({
  id: z.string(),
})

const toggleReactionSchema = z.object({
  commentId: z.string(),
  emoji: z.string(),
})

export type CreateCommentInput = z.infer<typeof createCommentSchema>
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>
export type DeleteCommentInput = z.infer<typeof deleteCommentSchema>
export type ToggleReactionInput = z.infer<typeof toggleReactionSchema>

// Write Operations
export const createCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(createCommentSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { createComment } = await import('@/lib/comments/comment.service')
    const { dispatchCommentCreated } = await import('@/lib/events/dispatch')

    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

    const result = await createComment(
      {
        postId: data.postId as PostId,
        content: data.content,
        parentId: data.parentId as CommentId | undefined,
      },
      {
        memberId: auth.member.id,
        name: auth.user.name,
        email: auth.user.email,
        role: auth.member.role,
      }
    )

    // Dispatch comment.created event (fire-and-forget)
    dispatchCommentCreated(
      { type: 'user', userId: auth.user.id as UserId, email: auth.user.email },
      {
        id: result.comment.id,
        content: result.comment.content,
        authorEmail: auth.user.email,
      },
      {
        id: result.post.id,
        title: result.post.title,
      }
    )

    return result
  })

export const updateCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(updateCommentSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { updateComment } = await import('@/lib/comments/comment.service')

    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

    return await updateComment(
      data.id as CommentId,
      {
        content: data.content,
      },
      {
        memberId: auth.member.id,
        role: auth.member.role,
      }
    )
  })

export const deleteCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteCommentSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { deleteComment } = await import('@/lib/comments/comment.service')

    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

    await deleteComment(data.id as CommentId, {
      memberId: auth.member.id,
      role: auth.member.role,
    })
    return { id: data.id }
  })

export const toggleReactionFn = createServerFn({ method: 'POST' })
  .inputValidator(toggleReactionSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { toggleReaction } = await import('@/lib/comments/comment.service')
    const { getMemberIdentifier } = await import('@/lib/user-identifier')

    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const userIdentifier = getMemberIdentifier(auth.member.id)

    return await toggleReaction(data.commentId as CommentId, data.emoji, userIdentifier)
  })

const getCommentPermissionsSchema = z.object({
  commentId: z.string(),
})

const userEditCommentSchema = z.object({
  commentId: z.string(),
  content: z.string(),
})

const userDeleteCommentSchema = z.object({
  commentId: z.string(),
})

export type GetCommentPermissionsInput = z.infer<typeof getCommentPermissionsSchema>
export type UserEditCommentInput = z.infer<typeof userEditCommentSchema>
export type UserDeleteCommentInput = z.infer<typeof userDeleteCommentSchema>

export const getCommentPermissionsFn = createServerFn({ method: 'GET' })
  .inputValidator(getCommentPermissionsSchema)
  .handler(async ({ data }) => {
    const { getSession } = await import('./auth')
    const { getOptionalAuth } = await import('./auth-helpers')
    const { canEditComment, canDeleteComment } = await import('@/lib/comments/comment.service')

    const session = await getSession()
    if (!session?.user) {
      return { canEdit: false, canDelete: false }
    }

    const ctx = await getOptionalAuth()
    if (!ctx?.user || !ctx?.member) {
      return { canEdit: false, canDelete: false }
    }

    const actor = { memberId: ctx.member.id, role: ctx.member.role }
    try {
      const [editResult, deleteResult] = await Promise.all([
        canEditComment(data.commentId as CommentId, actor),
        canDeleteComment(data.commentId as CommentId, actor),
      ])

      return {
        canEdit: editResult.allowed,
        canDelete: deleteResult.allowed,
      }
    } catch {
      // Comment not found or other error - return no permissions
      return { canEdit: false, canDelete: false }
    }
  })

export const userEditCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(userEditCommentSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { userEditComment } = await import('@/lib/comments/comment.service')

    const ctx = await requireAuth()
    const actor = { memberId: ctx.member.id, role: ctx.member.role }

    return await userEditComment(data.commentId as CommentId, data.content, actor)
  })

export const userDeleteCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(userDeleteCommentSchema)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('./auth-helpers')
    const { softDeleteComment } = await import('@/lib/comments/comment.service')

    const ctx = await requireAuth()
    const actor = { memberId: ctx.member.id, role: ctx.member.role }

    await softDeleteComment(data.commentId as CommentId, actor)
    return { id: data.commentId }
  })
