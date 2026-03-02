/**
 * Server functions for comment operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type CommentId, type PostId, type StatusId, type UserId } from '@quackback/ids'
import { isTeamMember } from '@/lib/shared/roles'

import {
  addReaction,
  canDeleteComment,
  canEditComment,
  canPinComment,
  createComment,
  deleteComment,
  pinComment,
  removeReaction,
  softDeleteComment,
  unpinComment,
  updateComment,
  userEditComment,
} from '@/lib/server/domains/comments/comment.service'
import { NotFoundError } from '@/lib/shared/errors'
import { getOptionalAuth, requireAuth, hasSessionCookie } from './auth-helpers'

// Schemas
const createCommentSchema = z.object({
  postId: z.string(),
  content: z.string().min(1).max(5000),
  parentId: z.string().optional(),
  statusId: z.string().optional(),
  isPrivate: z.boolean().optional(),
})

const updateCommentSchema = z.object({
  id: z.string(),
  content: z.string().min(1).max(5000),
})

const deleteCommentSchema = z.object({
  id: z.string(),
})

const reactionSchema = z.object({
  commentId: z.string(),
  emoji: z.string(),
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

// Types
export type CreateCommentInput = z.infer<typeof createCommentSchema>
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>
export type DeleteCommentInput = z.infer<typeof deleteCommentSchema>
export type ReactionInput = z.infer<typeof reactionSchema>
export type GetCommentPermissionsInput = z.infer<typeof getCommentPermissionsSchema>
export type UserEditCommentInput = z.infer<typeof userEditCommentSchema>
export type UserDeleteCommentInput = z.infer<typeof userDeleteCommentSchema>

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
          statusId: data.statusId as StatusId | undefined,
          isPrivate: data.isPrivate,
        },
        {
          principalId: auth.principal.id,
          userId: auth.user.id as UserId,
          name: auth.user.name,
          email: auth.user.email,
          role: auth.principal.role,
        }
      )

      // Events are dispatched by the service layer

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
          principalId: auth.principal.id,
          role: auth.principal.role,
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
        principalId: auth.principal.id,
        role: auth.principal.role,
      })
      console.log(`[fn:comments] deleteCommentFn: deleted id=${data.id}`)
      return { id: data.id }
    } catch (error) {
      console.error(`[fn:comments] ❌ deleteCommentFn failed:`, error)
      throw error
    }
  })

export const addReactionFn = createServerFn({ method: 'POST' })
  .inputValidator(reactionSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] addReactionFn: commentId=${data.commentId}, emoji=${data.emoji}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      const result = await addReaction(data.commentId as CommentId, data.emoji, auth.principal.id)
      console.log(`[fn:comments] addReactionFn: added=${result.added}`)
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ addReactionFn failed:`, error)
      throw error
    }
  })

export const removeReactionFn = createServerFn({ method: 'POST' })
  .inputValidator(reactionSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] removeReactionFn: commentId=${data.commentId}, emoji=${data.emoji}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
      const result = await removeReaction(
        data.commentId as CommentId,
        data.emoji,
        auth.principal.id
      )
      console.log(`[fn:comments] removeReactionFn: removed`)
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ removeReactionFn failed:`, error)
      throw error
    }
  })

// Read Operations
export const getCommentPermissionsFn = createServerFn({ method: 'GET' })
  .inputValidator(getCommentPermissionsSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] getCommentPermissionsFn: commentId=${data.commentId}`)
    try {
      // Early bailout: no session cookie = no permissions (skip DB queries)
      if (!hasSessionCookie()) {
        console.log(`[fn:comments] getCommentPermissionsFn: no session cookie, skipping auth`)
        return { canEdit: false, canDelete: false }
      }

      const ctx = await getOptionalAuth()
      if (!ctx?.principal) {
        console.log(`[fn:comments] getCommentPermissionsFn: no auth context`)
        return { canEdit: false, canDelete: false }
      }

      const actor = { principalId: ctx.principal.id, role: ctx.principal.role }
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
      if (error instanceof NotFoundError) {
        console.log(`[fn:comments] getCommentPermissionsFn: comment not found`)
        return { canEdit: false, canDelete: false }
      }
      console.error(`[fn:comments] getCommentPermissionsFn failed:`, error)
      throw error
    }
  })

export const userEditCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(userEditCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] userEditCommentFn: commentId=${data.commentId}`)
    try {
      const ctx = await requireAuth()
      const actor = { principalId: ctx.principal.id, role: ctx.principal.role }

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
      const actor = { principalId: ctx.principal.id, role: ctx.principal.role }

      await softDeleteComment(data.commentId as CommentId, actor)
      console.log(`[fn:comments] userDeleteCommentFn: deleted id=${data.commentId}`)
      return { id: data.commentId }
    } catch (error) {
      console.error(`[fn:comments] ❌ userDeleteCommentFn failed:`, error)
      throw error
    }
  })

// Pin/Unpin Operations
const pinCommentSchema = z.object({
  commentId: z.string(),
})

const unpinCommentSchema = z.object({
  postId: z.string(),
})

const canPinCommentSchema = z.object({
  commentId: z.string(),
})

export type PinCommentInput = z.infer<typeof pinCommentSchema>
export type UnpinCommentInput = z.infer<typeof unpinCommentSchema>
export type CanPinCommentInput = z.infer<typeof canPinCommentSchema>

export const pinCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(pinCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] pinCommentFn: commentId=${data.commentId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      const result = await pinComment(data.commentId as CommentId, {
        principalId: auth.principal.id,
        role: auth.principal.role,
      })
      console.log(
        `[fn:comments] pinCommentFn: pinned comment ${data.commentId} on post ${result.postId}`
      )
      return result
    } catch (error) {
      console.error(`[fn:comments] ❌ pinCommentFn failed:`, error)
      throw error
    }
  })

export const unpinCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(unpinCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] unpinCommentFn: postId=${data.postId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      await unpinComment(data.postId as PostId, {
        principalId: auth.principal.id,
        role: auth.principal.role,
      })
      console.log(`[fn:comments] unpinCommentFn: unpinned comment from post ${data.postId}`)
      return { postId: data.postId }
    } catch (error) {
      console.error(`[fn:comments] ❌ unpinCommentFn failed:`, error)
      throw error
    }
  })

export const canPinCommentFn = createServerFn({ method: 'GET' })
  .inputValidator(canPinCommentSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:comments] canPinCommentFn: commentId=${data.commentId}`)
    try {
      // Early bailout: no session cookie = can't pin (skip DB queries)
      if (!hasSessionCookie()) {
        console.log(`[fn:comments] canPinCommentFn: no session cookie, skipping auth`)
        return { canPin: false, reason: 'Only team members can pin comments' }
      }

      const ctx = await getOptionalAuth()
      // Must be a team member to pin
      if (!ctx?.principal || !isTeamMember(ctx.principal.role)) {
        return { canPin: false, reason: 'Only team members can pin comments' }
      }

      const result = await canPinComment(data.commentId as CommentId)
      console.log(`[fn:comments] canPinCommentFn: canPin=${result.canPin}`)
      return result
    } catch (error) {
      if (error instanceof NotFoundError) {
        console.log(`[fn:comments] canPinCommentFn: comment not found`)
        return { canPin: false, reason: 'Comment not found' }
      }
      console.error(`[fn:comments] canPinCommentFn failed:`, error)
      throw error
    }
  })
