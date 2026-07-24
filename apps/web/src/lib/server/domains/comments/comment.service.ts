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
  type ModerationState,
} from '@/lib/server/db'
import { type CommentId, type PrincipalId, type StatusId, type UserId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { subscribeToPost } from '@/lib/server/domains/subscriptions/subscription.service'
import {
  dispatchCommentUpdated,
  dispatchCommentDeleted,
  dispatchPostStatusChanged,
  buildEventActor,
} from '@/lib/server/events/dispatch'
import { dispatchCommentCreatedEvent } from './comment.announce'
import { commentMarkdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { CreateCommentInput, CreateCommentResult, UpdateCommentInput } from './comment.types'
import { canCreateComment } from '@/lib/server/policy/posts'
import type { Actor } from '@/lib/server/policy/types'
import { recordAuditEvent } from '@/lib/server/audit/log'
import { getPortalConfig } from '@/lib/server/domains/settings/settings.service'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'comments' })

/**
 * Resolve the TipTap doc to store. UI clients send `contentJson` directly
 * (the editor produces it natively); REST/API callers post only markdown,
 * so we parse + sanitise on their behalf. Markdown stays the API source of
 * truth; the JSON column is a render-time cache.
 *
 * Provided JSON is sanitised before storage: the read path prefers
 * contentJson, so a caller who supplied innocuous `content` and a wholly
 * different JSON shape would otherwise be able to render arbitrary nodes
 * regardless of the 5,000-char content cap.
 */
function resolveContentJson(
  content: string,
  provided: TiptapContent | null | undefined
): TiptapContent {
  if (provided) return sanitizeTiptapContent(provided)
  return commentMarkdownToTiptapJson(content)
}

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
  actor: Actor,
  options?: { skipDispatch?: boolean; headers?: Headers }
): Promise<CreateCommentResult> {
  log.info({ post_id: input.postId, parent_id: input.parentId ?? null }, 'create comment')
  // Validate post exists (and is not deleted) and eagerly load board in single query.
  // The relational `with: { board: true }` can't push isNull(boards.deletedAt) into
  // the join, so we filter the soft-deleted case in JS. Surface it as POST_NOT_FOUND
  // — a public caller doesn't need to distinguish post-not-found from board-deleted.
  const post = await db.query.posts.findFirst({
    where: and(eq(posts.id, input.postId), isNull(posts.deletedAt)),
    with: { board: true },
  })
  if (!post || !post.board || post.board.deletedAt) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${input.postId} not found`)
  }
  const board = post.board

  // Enforce access-control policy: board audience + post visibility + comments-locked.
  // Workspace moderation default is the fallback for board-level `inherit`.
  const portalConfig = await getPortalConfig()
  const decision = canCreateComment(
    actor,
    {
      moderationState: post.moderationState,
      principalId: post.principalId,
      isCommentsLocked: post.isCommentsLocked,
    },
    { access: board.access },
    portalConfig.moderationDefault.requireApproval
  )
  if (!decision.allowed) {
    throw new ForbiddenError('FORBIDDEN', decision.reason)
  }
  // canCreateComment.requiresApproval is true when the actor is non-team and
  // the resolved `moderation.comments` rule is `'on'`. Held comments land
  // with moderationState='pending' so they don't appear publicly until a
  // moderator approves them via approveCommentFn.
  const initialModerationState: ModerationState = decision.requiresApproval
    ? 'pending'
    : 'published'

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

  const trimmedContent = input.content.trim()
  const contentJson = resolveContentJson(trimmedContent, input.contentJson)

  let comment: Comment
  let previousStatusName: string | null = null
  let newStatusName: string | null = null
  let previousStatusSlug: string | null = null
  let newStatusSlug: string | null = null

  if (shouldChangeStatus) {
    // Fetch new status and current post status in parallel
    const [newStatus, prevStatus] = await Promise.all([
      db.query.postStatuses.findFirst({ where: eq(postStatuses.id, input.statusId as StatusId) }),
      post.statusId
        ? db.query.postStatuses.findFirst({ where: eq(postStatuses.id, post.statusId) })
        : null,
    ])

    if (!newStatus) {
      throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${input.statusId} not found`)
    }

    previousStatusName = prevStatus?.name ?? 'Open'
    newStatusName = newStatus.name
    previousStatusSlug = prevStatus?.slug ?? 'open'
    newStatusSlug = newStatus.slug

    // Atomic transaction: insert comment + update post status + conditionally increment comment count
    const result = await db.transaction(async (tx) => {
      const [insertedComment] = await tx
        .insert(comments)
        .values({
          postId: input.postId,
          content: trimmedContent,
          contentJson,
          parentId: input.parentId || null,
          principalId: author.principalId,
          isTeamMember: authorIsTeamMember,
          isPrivate,
          moderationState: initialModerationState,
          statusChangeFromId: prevStatus?.id ?? null,
          statusChangeToId: newStatus.id,
          ...(input.createdAt && { createdAt: input.createdAt }),
        })
        .returning()

      await tx
        .update(posts)
        .set({
          statusId: input.statusId as StatusId,
          // Private and pending comments don't count toward the public
          // commentCount. Pending comments are held back from public reads
          // (see post.public.detail.ts) — `approveCommentFn` re-increments
          // the count when the comment becomes visible. Rejected (soft-
          // deleted) pending comments stay uncounted since they never
          // incremented in the first place.
          ...(isPrivate || initialModerationState === 'pending'
            ? {}
            : { commentCount: sql`${posts.commentCount} + 1` }),
        })
        .where(eq(posts.id, input.postId))

      return insertedComment
    })

    comment = result

    // Mirror the status transition into the post_activity log, exactly as the
    // direct status-change paths (post.status.ts, post.service.ts) do. Without
    // this the audit timeline silently omits status changes made through a
    // comment, and analytics has to union the comments table to find them.
    // Fire-and-forget, like the other paths; the status was already committed.
    createActivity({
      postId: input.postId,
      principalId: author.principalId,
      type: 'status.changed',
      metadata: {
        fromName: previousStatusName,
        fromColor: prevStatus?.color ?? null,
        toName: newStatus.name,
        // Stable identifier (names are editable) so analytics can match the
        // target status by slug even after a rename.
        toSlug: newStatus.slug,
        toColor: newStatus.color ?? null,
      },
    })
  } else {
    // Atomic transaction: insert comment + conditionally increment comment count
    const result = await db.transaction(async (tx) => {
      const [insertedComment] = await tx
        .insert(comments)
        .values({
          postId: input.postId,
          content: trimmedContent,
          contentJson,
          parentId: input.parentId || null,
          principalId: author.principalId,
          isTeamMember: authorIsTeamMember,
          isPrivate,
          moderationState: initialModerationState,
          ...(input.createdAt && { createdAt: input.createdAt }),
        })
        .returning()

      // Private and pending comments don't count toward the public
      // commentCount. Pending comments are held back from public reads
      // (see post.public.detail.ts) — `approveCommentFn` re-increments
      // the count when the comment becomes visible.
      if (!isPrivate && initialModerationState !== 'pending') {
        await tx
          .update(posts)
          .set({ commentCount: sql`${posts.commentCount} + 1` })
          .where(eq(posts.id, input.postId))
      }

      return insertedComment
    })

    comment = result
  }

  if (initialModerationState === 'pending') {
    // Record audit trail for held comments. Mirrors the post.moderation.held
    // pattern in post.service.ts so moderators have a uniform timeline.
    await recordAuditEvent({
      event: 'comment.moderation.held',
      actor: {
        userId: author.userId,
        email: author.email,
        role: actor.role,
        type: actor.principalType,
      },
      headers: options?.headers,
      target: { type: 'comment', id: comment.id },
      after: { moderationState: 'pending' },
      metadata: { postId: post.id, boardId: board.id, principalType: actor.principalType },
    })
  }

  // Auto-subscribe commenter to the post even when held — so the author
  // receives the approval/rejection notification and any subsequent thread
  // activity once approved. Mirrors post.service.ts which subscribes
  // authors of held posts.
  if (!options?.skipDispatch && author.principalId) {
    await subscribeToPost(author.principalId, input.postId, 'comment')
  }

  // External dispatch (webhooks, Slack, @-mention emails) is deferred until
  // the comment is visible. Held comments fire dispatch only on approval
  // via approveCommentFn — mirroring the post-moderation flow.
  if (!options?.skipDispatch && initialModerationState === 'published') {
    // Dispatch comment.created for webhooks, Slack, etc. Shares the payload
    // mapping with approveCommentFn's release path via dispatchCommentCreatedEvent.
    await dispatchCommentCreatedEvent(
      author,
      { id: comment.id, content: comment.content, isPrivate },
      { id: post.id, title: post.title, boardId: board.id, boardSlug: board.slug }
    )

    // Dispatch status change event if status was changed
    if (shouldChangeStatus && previousStatusName && newStatusName && newStatusSlug) {
      await dispatchPostStatusChanged(
        buildEventActor(author),
        {
          id: post.id,
          title: post.title,
          boardId: board.id,
          boardSlug: board.slug,
        },
        previousStatusName,
        newStatusName,
        previousStatusSlug ?? 'open',
        newStatusSlug
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
  log.info({ comment_id: id }, 'update comment')
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
  if (input.content !== undefined) {
    const trimmed = input.content.trim()
    updateData.content = trimmed
    updateData.contentJson = resolveContentJson(trimmed, input.contentJson)
  } else if (input.contentJson !== undefined) {
    updateData.contentJson = input.contentJson
  }

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
  log.info({ comment_id: id }, 'delete comment')
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

  // Atomic transaction: delete comment + conditionally decrement comment count
  await db.transaction(async (tx) => {
    const result = await tx.delete(comments).where(eq(comments.id, id)).returning()
    if (result.length === 0) {
      throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${id} not found`)
    }

    // Decide the decrement from the deleted row's own state (DELETE locks the
    // row), not the pre-transaction snapshot: a concurrent approval could have
    // published + counted a previously-pending comment between the read and
    // here. Skip when already soft-deleted (the soft-delete already decremented)
    // or when the comment was never counted (private / still-pending).
    const deleted = result[0]
    const shouldDecrement =
      !deleted.deletedAt && !deleted.isPrivate && deleted.moderationState !== 'pending'
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
