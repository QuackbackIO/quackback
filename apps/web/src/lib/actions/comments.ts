import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSession } from '@/lib/auth/server'
import { db, member, eq, and, commentReactions, REACTION_EMOJIS } from '@/lib/db'
import {
  createComment,
  canEditComment,
  canDeleteComment,
  userEditComment,
  softDeleteComment,
  addReaction,
  removeReaction,
} from '@/lib/comments'
import { getBoardByPostId } from '@/lib/posts'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { getSettings } from '@/lib/workspace'
import { buildCommentCreatedEvent } from '@/lib/events'
import { getJobAdapter } from '@quackback/jobs'
import {
  postIdSchema,
  commentIdSchema,
  isValidTypeId,
  type PostId,
  type CommentId,
  type MemberId,
  type UserId,
} from '@quackback/ids'
import { actionOk, actionErr, mapDomainError, type ActionResult } from './types'

// ============================================
// Schemas
// ============================================

const createCommentSchema = z.object({
  postId: postIdSchema,
  content: z.string().min(1, 'Comment is required').max(5000, 'Comment is too long'),
  parentId: z.string().nullable().optional(),
})

const getCommentPermissionsSchema = z.object({
  commentId: commentIdSchema,
})

const userEditCommentSchema = z.object({
  commentId: commentIdSchema,
  content: z.string().min(1, 'Comment is required').max(5000, 'Comment is too long'),
})

const userDeleteCommentSchema = z.object({
  commentId: commentIdSchema,
})

const toggleReactionSchema = z.object({
  commentId: commentIdSchema,
  emoji: z.string().min(1),
})

// ============================================
// Type Exports
// ============================================

export type CreateCommentInput = z.infer<typeof createCommentSchema>
export type GetCommentPermissionsInput = z.infer<typeof getCommentPermissionsSchema>
export type UserEditCommentInput = z.infer<typeof userEditCommentSchema>
export type UserDeleteCommentInput = z.infer<typeof userDeleteCommentSchema>
export type ToggleReactionInput = z.infer<typeof toggleReactionSchema>

// ============================================
// Helper Functions
// ============================================

async function getMemberRecord(userId: UserId) {
  return db.query.member.findFirst({
    where: eq(member.userId, userId),
  })
}

function buildAuthor(
  session: { user: { id: string; email: string; name: string | null } },
  memberRecord: { id: string; role: string }
) {
  return {
    memberId: memberRecord.id as MemberId,
    name: session.user.name || session.user.email,
    email: session.user.email,
    role: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
  }
}

function buildActor(memberRecord: { id: string; role: string }) {
  return {
    memberId: memberRecord.id as MemberId,
    role: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
  }
}

// ============================================
// Server Functions
// ============================================

/**
 * Create a comment on a post.
 */
export const createCommentAction = createServerFn({ method: 'POST' })
  .inputValidator(createCommentSchema)
  .handler(async ({ data }) => {
    try {
      const { postId: postIdRaw, content, parentId } = data
      const postId = postIdRaw as PostId

      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please sign in to comment.',
          status: 401,
        })
      }

      const memberRecord = await getMemberRecord(session.user.id as UserId)
      if (!memberRecord) {
        return actionErr({
          code: 'FORBIDDEN',
          message: 'You must be a member to comment.',
          status: 403,
        })
      }

      const boardResult = await getBoardByPostId(postId)
      if (!boardResult.success || !boardResult.value) {
        return actionErr({ code: 'NOT_FOUND', message: 'Post not found', status: 404 })
      }
      const board = boardResult.value

      const isTeamMember = ['owner', 'admin', 'member'].includes(memberRecord.role)
      if (!board.isPublic && !isTeamMember) {
        return actionErr({ code: 'NOT_FOUND', message: 'Post not found', status: 404 })
      }

      let parentIdTypeId: CommentId | null = null
      if (parentId) {
        if (!isValidTypeId(parentId, 'comment')) {
          return actionErr({
            code: 'VALIDATION_ERROR',
            message: 'Invalid parent comment ID format',
            status: 400,
          })
        }
        parentIdTypeId = parentId as CommentId
      }

      const author = buildAuthor(session, memberRecord)

      const serviceResult = await createComment(
        {
          postId,
          content,
          parentId: parentIdTypeId,
          authorName: null,
          authorEmail: null,
        },
        author
      )

      if (!serviceResult.success) {
        return actionErr(mapDomainError(serviceResult.error))
      }

      const { comment, post } = serviceResult.value
      const settings = await getSettings()
      if (settings) {
        const eventData = buildCommentCreatedEvent(
          { type: 'user', userId: session.user.id as UserId, email: author.email },
          { id: comment.id, content: comment.content, authorEmail: author.email },
          { id: post.id, title: post.title }
        )

        const jobAdapter = getJobAdapter()
        await jobAdapter.addEventJob(eventData)
      }

      return actionOk(comment)
    } catch (error) {
      console.error('Error creating comment:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })

/**
 * Get edit/delete permissions for a comment.
 */
export const getCommentPermissionsAction = createServerFn({ method: 'POST' })
  .inputValidator(getCommentPermissionsSchema)
  .handler(
    async ({
      data,
    }): Promise<
      ActionResult<{
        canEdit: boolean
        canDelete: boolean
        editReason?: string
        deleteReason?: string
      }>
    > => {
      try {
        const commentId = data.commentId as CommentId

        const session = await getSession()
        if (!session?.user) {
          return actionOk({ canEdit: false, canDelete: false })
        }

        const memberRecord = await getMemberRecord(session.user.id as UserId)
        if (!memberRecord) {
          return actionOk({ canEdit: false, canDelete: false })
        }

        const actor = buildActor(memberRecord)

        const [editResult, deleteResult] = await Promise.all([
          canEditComment(commentId, actor),
          canDeleteComment(commentId, actor),
        ])

        return actionOk({
          canEdit: editResult.success ? editResult.value.allowed : false,
          canDelete: deleteResult.success ? deleteResult.value.allowed : false,
          editReason: editResult.success ? editResult.value.reason : undefined,
          deleteReason: deleteResult.success ? deleteResult.value.reason : undefined,
        })
      } catch (error) {
        console.error('Error getting comment permissions:', error)
        return actionErr({
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          status: 500,
        })
      }
    }
  )

/**
 * User edits their own comment.
 */
export const userEditCommentAction = createServerFn({ method: 'POST' })
  .inputValidator(userEditCommentSchema)
  .handler(async ({ data }) => {
    try {
      const { commentId: commentIdRaw, content } = data
      const commentId = commentIdRaw as CommentId

      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please sign in to edit.',
          status: 401,
        })
      }

      const memberRecord = await getMemberRecord(session.user.id as UserId)
      if (!memberRecord) {
        return actionErr({
          code: 'FORBIDDEN',
          message: 'You must be a member to edit comments.',
          status: 403,
        })
      }

      const actor = buildActor(memberRecord)

      const result = await userEditComment(commentId, content, actor)
      if (!result.success) {
        return actionErr(mapDomainError(result.error))
      }

      return actionOk(result.value)
    } catch (error) {
      console.error('Error editing comment:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })

/**
 * User soft-deletes their own comment.
 */
export const userDeleteCommentAction = createServerFn({ method: 'POST' })
  .inputValidator(userDeleteCommentSchema)
  .handler(async ({ data }): Promise<ActionResult<{ success: boolean }>> => {
    try {
      const commentId = data.commentId as CommentId

      const session = await getSession()
      if (!session?.user) {
        return actionErr({
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please sign in to delete.',
          status: 401,
        })
      }

      const memberRecord = await getMemberRecord(session.user.id as UserId)
      if (!memberRecord) {
        return actionErr({
          code: 'FORBIDDEN',
          message: 'You must be a member to delete comments.',
          status: 403,
        })
      }

      const actor = buildActor(memberRecord)

      const result = await softDeleteComment(commentId, actor)
      if (!result.success) {
        return actionErr(mapDomainError(result.error))
      }

      return actionOk({ success: true })
    } catch (error) {
      console.error('Error deleting comment:', error)
      return actionErr({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        status: 500,
      })
    }
  })

/**
 * Toggle a reaction on a comment.
 */
export const toggleReactionAction = createServerFn({ method: 'POST' })
  .inputValidator(toggleReactionSchema)
  .handler(
    async ({
      data,
    }): Promise<
      ActionResult<{
        added: boolean
        reactions: Array<{ emoji: string; count: number; hasReacted: boolean }>
      }>
    > => {
      try {
        const { commentId: commentIdRaw, emoji } = data
        const commentId = commentIdRaw as CommentId

        if (!REACTION_EMOJIS.includes(emoji as (typeof REACTION_EMOJIS)[number])) {
          return actionErr({
            code: 'VALIDATION_ERROR',
            message: 'Invalid emoji',
            status: 400,
          })
        }

        const session = await getSession()
        if (!session?.user) {
          return actionErr({
            code: 'UNAUTHORIZED',
            message: 'Authentication required. Please sign in to react.',
            status: 401,
          })
        }

        const comment = await db.query.comments.findFirst({
          where: (comments, { eq }) => eq(comments.id, commentId),
        })
        if (!comment) {
          return actionErr({ code: 'NOT_FOUND', message: 'Comment not found', status: 404 })
        }

        const post = await db.query.posts.findFirst({
          where: (posts, { eq }) => eq(posts.id, comment.postId),
        })
        if (!post) {
          return actionErr({ code: 'NOT_FOUND', message: 'Post not found', status: 404 })
        }

        const memberRecord = await getMemberRecord(session.user.id as UserId)
        if (!memberRecord) {
          return actionErr({
            code: 'FORBIDDEN',
            message: 'You must be a member to react.',
            status: 403,
          })
        }

        const userIdentifier = getMemberIdentifier(memberRecord.id)

        const existingReaction = await db.query.commentReactions.findFirst({
          where: and(
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.userIdentifier, userIdentifier),
            eq(commentReactions.emoji, emoji)
          ),
        })

        const serviceResult = existingReaction
          ? await removeReaction(commentId, emoji, userIdentifier)
          : await addReaction(commentId, emoji, userIdentifier)

        if (!serviceResult.success) {
          return actionErr(mapDomainError(serviceResult.error))
        }

        return actionOk(serviceResult.value)
      } catch (error) {
        console.error('Error toggling reaction:', error)
        return actionErr({
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          status: 500,
        })
      }
    }
  )
