import {
  db,
  eq,
  and,
  isNull,
  sql,
  comments,
  posts,
  postStatuses,
  type Comment,
} from '@/lib/server/db'
import { type CommentId, type PrincipalId, type StatusId, type UserId } from '@featurepool/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { subscribeToPost } from '@/lib/server/domains/subscriptions/subscription.service'
import {
  dispatchCommentCreated,
  dispatchCommentUpdated,
  dispatchCommentDeleted,
  dispatchPostStatusChanged,
  buildEventActor,
} from '@/lib/server/events/dispatch'
import type { CreateCommentInput, CreateCommentResult, UpdateCommentInput } from './comment.types'

export async function createComment(
  input: CreateCommentInput,
  author: {
    principalId: PrincipalId
    userId?: UserId
    name?: string
    email?: string
    displayName?: string
    role: 'admin' | 'member' | 'user'
  },
  options?: { skipDispatch?: boolean }
): Promise<CreateCommentResult> {
  console.log(
    `[domain:comments] createComment: postId=${input.postId}, parentId=${input.parentId ?? 'none'}`
  )
  // Validate post exists (and is not deleted) and eagerly load board in single query
  const post = await db.query.posts.findFirst({
    where: and(eq(posts.id, input.postId), isNull(posts.deletedAt)),
    with: { board: true },
  })
  if (!post || !post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${input.postId} not found`)
  }
  const board = post.board

  // Check if comments are locked (portal users blocked, team members bypass)
  if (post.isCommentsLocked && author.role === 'user') {
    throw new ForbiddenError('COMMENTS_LOCKED', 'Comments are locked on this post')
  }

  // Validate parent comment exists if specified
  let parentIsPrivate = false
  if (input.parentId) {
    const parentComment = await db.query.comments.findFirst({
      where: eq(comments.id, input.parentId),
    })
    if (!parentComment) {
      throw new ValidationError(
        'INVALID_PARENT',
        `Parent comment with ID ${input.parentId} not found`
      )
    }

    // Ensure parent comment belongs to the same post
    if (parentComment.postId !== input.postId) {
      throw new ValidationError('VALIDATION_ERROR', 'Parent comment belongs to a different post')
    }

    parentIsPrivate = parentComment.isPrivate
  }

  // Validate input
  if (!input.content?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Content is required')
  }
  if (input.content.length > 5000) {
    throw new ValidationError('VALIDATION_ERROR', 'Content must be 5,000 characters or less')
  }

  // Determine if user is a team member
  const authorIsTeamMember = isTeamMember(author.role)

  // Inherit privacy from parent: replies to private comments are always private
  const isPrivate = parentIsPrivate || (input.isPrivate ?? false)

  // Enforce team-only for private comments (after inheritance, so replying to
  // a private parent with isPrivate omitted is also caught)
  if (isPrivate && !authorIsTeamMember) {
    throw new ForbiddenError(
      'PRIVATE_COMMENT_FORBIDDEN',
      'Only team members can post private comments'
    )
  }

  // Determine if a status change should be applied
  // Only for team members, root-level comments, with a valid statusId
  const shouldChangeStatus = !!(input.statusId && authorIsTeamMember && !input.parentId)

  let comment: Comment
  let previousStatusName: string | null = null
  let newStatusName: string | null = null

  if (shouldChangeStatus) {
    // Fetch new status and current post status in parallel
    const [newStatus, prevStatus] = await Promise.all([
      db.query.postStatuses.findFirst({ where: eq(postStatuses.id, input.statusId as StatusId) }),
      post.statusId
        ? db.query.postStatuses.findFirst({ where: eq(postStatuses.id, post.statusId) })
        : Promise.resolve(null),
    ])

    if (!newStatus) {
      throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${input.statusId} not found`)
    }

    previousStatusName = prevStatus?.name ?? 'Open'
    newStatusName = newStatus.name

    // Atomic transaction: insert comment + update post status + conditionally increment comment count
    const result = await db.transaction(async (tx) => {
      const [insertedComment] = await tx
        .insert(comments)
        .values({
          postId: input.postId,
          content: input.content.trim(),
          parentId: input.parentId || null,
          principalId: author.principalId,
          isTeamMember: authorIsTeamMember,
          isPrivate,
          statusChangeFromId: prevStatus?.id ?? null,
          statusChangeToId: newStatus.id,
          ...(input.createdAt && { createdAt: input.createdAt }),
        })
        .returning()

      await tx
        .update(posts)
        .set({
          statusId: input.statusId as StatusId,
          // Private comments don't count toward the public comment count
          ...(isPrivate ? {} : { commentCount: sql`${posts.commentCount} + 1` }),
        })
        .where(eq(posts.id, input.postId))

      return insertedComment
    })

    comment = result
  } else {
    // Atomic transaction: insert comment + conditionally increment comment count
    const result = await db.transaction(async (tx) => {
      const [insertedComment] = await tx
        .insert(comments)
        .values({
          postId: input.postId,
          content: input.content.trim(),
          parentId: input.parentId || null,
          principalId: author.principalId,
          isTeamMember: authorIsTeamMember,
          isPrivate,
          ...(input.createdAt && { createdAt: input.createdAt }),
        })
        .returning()

      // Private comments don't count toward the public comment count
      if (!isPrivate) {
        await tx
          .update(posts)
          .set({ commentCount: sql`${posts.commentCount} + 1` })
          .where(eq(posts.id, input.postId))
      }

      return insertedComment
    })

    comment = result
  }

  if (!options?.skipDispatch) {
    // Auto-subscribe commenter to the post
    if (author.principalId) {
      await subscribeToPost(author.principalId, input.postId, 'comment')
    }

    // Dispatch comment.created event for webhooks, Slack, etc.
    const actorName = author.displayName ?? author.name
    await dispatchCommentCreated(
      buildEventActor(author),
      {
        id: comment.id,
        content: comment.content,
        authorName: actorName,
        authorEmail: author.email,
        isPrivate,
      },
      {
        id: post.id,
        title: post.title,
        boardId: board.id,
        boardSlug: board.slug,
      }
    )

    // Dispatch status change event if status was changed
    if (shouldChangeStatus && previousStatusName && newStatusName) {
      await dispatchPostStatusChanged(
        buildEventActor(author),
        {
          id: post.id,
          title: post.title,
          boardId: board.id,
          boardSlug: board.slug,
        },
        previousStatusName,
        newStatusName
      )
    }
  }

  return { comment, post: { id: post.id, title: post.title, boardSlug: board.slug } }
}

export async function updateComment(
  id: CommentId,
  input: UpdateCommentInput,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user'; userId?: UserId }
): Promise<Comment> {
  console.log(`[domain:comments] updateComment: id=${id}`)
  // Get existing comment with post and board in single query
  const existingComment = await db.query.comments.findFirst({
    where: eq(comments.id, id),
    with: {
      post: {
        with: { board: true },
      },
    },
  })
  if (!existingComment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${id} not found`)
  }
  if (!existingComment.post || !existingComment.post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${existingComment.postId} not found`)
  }

  // Authorization check - user must be comment author or team member
  const isAuthor = existingComment.principalId === actor.principalId

  if (!isAuthor && !isTeamMember(actor.role)) {
    throw new ForbiddenError('UNAUTHORIZED', 'You are not authorized to update this comment')
  }

  // Validate input
  if (input.content !== undefined) {
    if (!input.content.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Content cannot be empty')
    }
    if (input.content.length > 5000) {
      throw new ValidationError('VALIDATION_ERROR', 'Content must be 5,000 characters or less')
    }
  }

  // Build update data
  const updateData: Partial<Comment> = {}
  if (input.content !== undefined) updateData.content = input.content.trim()

  // Update the comment
  const [updatedComment] = await db
    .update(comments)
    .set(updateData)
    .where(eq(comments.id, id))
    .returning()

  if (!updatedComment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${id} not found`)
  }

  // Dispatch comment.updated event for webhooks and integrations
  const post = existingComment.post
  const board = post.board
  dispatchCommentUpdated(
    buildEventActor({ principalId: actor.principalId, userId: actor.userId }),
    {
      id: updatedComment.id,
      content: updatedComment.content,
      isPrivate: updatedComment.isPrivate ?? undefined,
    },
    {
      id: post.id,
      title: post.title,
      boardId: board.id,
      boardSlug: board.slug,
    }
  )

  return updatedComment
}

/**
 * Delete a comment
 *
 * Validates that:
 * - Comment exists and belongs to the organization
 * - User has permission to delete the comment (must be the author or team member)
 *
 * Note: Deleting a comment will cascade delete all replies due to database constraints
 *
 * @param id - Comment ID to delete
 * @param actor - Actor information with principalId and role
 * @returns Result indicating success or an error
 */
export async function deleteComment(
  id: CommentId,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user'; userId?: UserId }
): Promise<void> {
  console.log(`[domain:comments] deleteComment: id=${id}`)
  // Get existing comment with post and board in single query
  const existingComment = await db.query.comments.findFirst({
    where: eq(comments.id, id),
    with: {
      post: {
        with: { board: true },
      },
    },
  })
  if (!existingComment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${id} not found`)
  }
  if (!existingComment.post || !existingComment.post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${existingComment.postId} not found`)
  }

  // Authorization check - user must be comment author or team member
  const isAuthor = existingComment.principalId === actor.principalId

  if (!isAuthor && !isTeamMember(actor.role)) {
    throw new ForbiddenError('UNAUTHORIZED', 'You are not authorized to delete this comment')
  }

  // Only decrement count if comment is not already soft-deleted
  // (soft-delete already decremented the count)
  // Private comments never incremented the count, so skip decrement for them
  const wasActive = !existingComment.deletedAt
  const shouldDecrement = wasActive && !existingComment.isPrivate

  // Atomic transaction: delete comment + conditionally decrement comment count
  await db.transaction(async (tx) => {
    const result = await tx.delete(comments).where(eq(comments.id, id)).returning()
    if (result.length === 0) {
      throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${id} not found`)
    }

    if (shouldDecrement) {
      await tx
        .update(posts)
        .set({ commentCount: sql`GREATEST(0, ${posts.commentCount} - ${result.length})` })
        .where(eq(posts.id, existingComment.postId))
    }
  })

  // Dispatch comment.deleted event for webhooks and integrations
  const post = existingComment.post
  const board = post.board
  dispatchCommentDeleted(
    buildEventActor({ principalId: actor.principalId, userId: actor.userId }),
    {
      id,
      isPrivate: existingComment.isPrivate ?? undefined,
    },
    {
      id: post.id,
      title: post.title,
      boardId: board.id,
      boardSlug: board.slug,
    }
  )
}
