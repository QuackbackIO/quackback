/**
 * Server functions for comment operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type CommentId, type PostId, type UserId } from '@quackback/ids'
import { requireAuth, getOptionalAuth } from './auth-helpers'
import { getSession } from './auth'
import {
  createComment,
  updateComment,
  deleteComment,
  toggleReaction,
  canEditComment,
  canDeleteComment,
  userEditComment,
  softDeleteComment,
} from '@/lib/comments/comment.service'
import { dispatchCommentCreated } from '@/lib/events/dispatch'
import { getMemberIdentifier } from '@/lib/user-identifier'

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
    console.log(`[fn:comments] createCommentFn: postId=${data.postId}`)
    try {
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

      console.log(`[fn:comments] createCommentFn: id=${result.comment.id}`)
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ createCommentFn failed:`, error)
      throw error
    }
  })

export const updateCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(updateCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] updateCommentFn: id=${data.id}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

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
      console.log(`[fn:comments] updateCommentFn: updated id=${data.id}`)
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ updateCommentFn failed:`, error)
      throw error
    }
  })

export const deleteCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] deleteCommentFn: id=${data.id}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })

      await deleteComment(data.id as CommentId, {
        memberId: auth.member.id,
        role: auth.member.role,
      })
      console.log(`[fn:comments] deleteCommentFn: deleted id=${data.id}`)
      return { id: data.id }
    } catch (error) {
      console.error(`[fn:comments] ❌ deleteCommentFn failed:`, error)
      throw error
    }
  })

export const toggleReactionFn = createServerFn({ method: 'POST' })
  .inputValidator(toggleReactionSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] toggleReactionFn: commentId=${data.commentId}, emoji=${data.emoji}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      const userIdentifier = getMemberIdentifier(auth.member.id)

      const result = await toggleReaction(data.commentId as CommentId, data.emoji, userIdentifier)
      console.log(`[fn:comments] toggleReactionFn: toggled`)
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ toggleReactionFn failed:`, error)
      throw error
    }
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
    console.log(`[fn:comments] getCommentPermissionsFn: commentId=${data.commentId}`)
    try {
      const session = await getSession()
      if (!session?.user) {
        console.log(`[fn:comments] getCommentPermissionsFn: no session`)
        return { canEdit: false, canDelete: false }
      }

      const ctx = await getOptionalAuth()
      if (!ctx?.user || !ctx?.member) {
        console.log(`[fn:comments] getCommentPermissionsFn: no auth context`)
        return { canEdit: false, canDelete: false }
      }

      const actor = { memberId: ctx.member.id, role: ctx.member.role }
      const [editResult, deleteResult] = await Promise.all([
        canEditComment(data.commentId as CommentId, actor),
        canDeleteComment(data.commentId as CommentId, actor),
      ])

      console.log(
        `[fn:comments] getCommentPermissionsFn: canEdit=${editResult.allowed}, canDelete=${deleteResult.allowed}`
      )
      return {
        canEdit: editResult.allowed,
        canDelete: deleteResult.allowed,
      }
    } catch (error) {
      // Comment not found or other error - return no permissions
      console.error(`[fn:comments] ❌ getCommentPermissionsFn failed:`, error)
      return { canEdit: false, canDelete: false }
    }
  })

export const userEditCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(userEditCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] userEditCommentFn: commentId=${data.commentId}`)
    try {
      const ctx = await requireAuth()
      const actor = { memberId: ctx.member.id, role: ctx.member.role }

      const result = await userEditComment(data.commentId as CommentId, data.content, actor)
      console.log(`[fn:comments] userEditCommentFn: edited id=${data.commentId}`)
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ userEditCommentFn failed:`, error)
      throw error
    }
  })

export const userDeleteCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(userDeleteCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] userDeleteCommentFn: commentId=${data.commentId}`)
    try {
      const ctx = await requireAuth()
      const actor = { memberId: ctx.member.id, role: ctx.member.role }

      await softDeleteComment(data.commentId as CommentId, actor)
      console.log(`[fn:comments] userDeleteCommentFn: deleted id=${data.commentId}`)
      return { id: data.commentId }
    } catch (error) {
      console.error(`[fn:comments] ❌ userDeleteCommentFn failed:`, error)
      throw error
    }
  })
