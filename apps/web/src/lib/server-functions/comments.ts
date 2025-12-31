/**
 * Server functions for comment operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth, getOptionalAuth } from './auth-helpers'
import { getSession } from '@/lib/server-functions/auth'
import {
  createComment,
  updateComment,
  deleteComment,
  toggleReaction,
  canEditComment,
  canDeleteComment,
  userEditComment,
  softDeleteComment,
} from '@/lib/comments'
import { type CommentId, type PostId, type UserId } from '@quackback/ids'
import { dispatchCommentCreated } from '@/lib/events/dispatch'

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
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member', 'user'] })

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
    if (!result.success) throw new Error(result.error.message)

    // Dispatch comment.created event (fire-and-forget)
    dispatchCommentCreated(
      { type: 'user', userId: auth.user.id as UserId, email: auth.user.email },
      {
        id: result.value.comment.id,
        content: result.value.comment.content,
        authorEmail: auth.user.email,
      },
      {
        id: result.value.post.id,
        title: result.value.post.title,
      }
    )

    return result.value
  })

export const updateCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(updateCommentSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member', 'user'] })

    const result = await updateComment(
      data.id as CommentId,
      {
        content: data.content,
      },
      {
        memberId: auth.member.id,
        role: auth.member.role,
      }
    )
    if (!result.success) throw new Error(result.error.message)
    return result.value
  })

export const deleteCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteCommentSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['owner', 'admin', 'member', 'user'] })

    const result = await deleteComment(data.id as CommentId, {
      memberId: auth.member.id,
      role: auth.member.role,
    })
    if (!result.success) throw new Error(result.error.message)
    return { id: data.id }
  })

export const toggleReactionFn = createServerFn({ method: 'POST' })
  .inputValidator(toggleReactionSchema)
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session?.user) throw new Error('Authentication required')

    const result = await toggleReaction(data.commentId as CommentId, data.emoji, session.user.id)
    if (!result.success) throw new Error(result.error.message)
    return result.value
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
    const session = await getSession()
    if (!session?.user) {
      return { canEdit: false, canDelete: false }
    }

    const ctx = await getOptionalAuth()
    if (!ctx.user || !ctx.member) {
      return { canEdit: false, canDelete: false }
    }

    const actor = { memberId: ctx.member.id, role: ctx.member.role }
    const [editResult, deleteResult] = await Promise.all([
      canEditComment(data.commentId as CommentId, actor),
      canDeleteComment(data.commentId as CommentId, actor),
    ])

    return {
      canEdit: editResult.success ? editResult.value.allowed : false,
      canDelete: deleteResult.success ? deleteResult.value.allowed : false,
    }
  })

export const userEditCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(userEditCommentSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const actor = { memberId: ctx.member.id, role: ctx.member.role }

    const result = await userEditComment(data.commentId as CommentId, data.content, actor)
    if (!result.success) throw new Error(result.error.message)
    return result.value
  })

export const userDeleteCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(userDeleteCommentSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const actor = { memberId: ctx.member.id, role: ctx.member.role }

    const result = await softDeleteComment(data.commentId as CommentId, actor)
    if (!result.success) throw new Error(result.error.message)
    return { id: data.commentId }
  })
