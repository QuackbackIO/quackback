/**
 * Post User Actions
 *
 * Handles user-initiated write operations: edit, soft delete, restore, and permanent delete.
 * Permission helpers (canEditPost, canDeletePost, getPostPermissions) live in post.permissions.ts.
 */

import {
  db,
  posts,
  boards,
  comments,
  postEditHistory,
  eq,
  and,
  sql,
  isNull,
  type Post,
} from '@/lib/server/db'
import { type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import {
  dispatchPostDeleted,
  dispatchPostRestored,
  buildEventActor,
} from '@/lib/server/events/dispatch'
import { DEFAULT_PORTAL_CONFIG, type PortalConfig } from '@/lib/server/domains/settings'
import type { UserEditPostInput } from './post.types'

// ============================================================================
// Internal Helpers (duplicated from post.permissions.ts for independence)
// ============================================================================

async function getPortalConfig(): Promise<PortalConfig> {
  const org = await db.query.settings.findFirst()

  if (!org?.portalConfig) {
    return DEFAULT_PORTAL_CONFIG
  }

  let config: Partial<PortalConfig>
  try {
    config = JSON.parse(org.portalConfig) as Partial<PortalConfig>
  } catch {
    return DEFAULT_PORTAL_CONFIG
  }

  return {
    ...DEFAULT_PORTAL_CONFIG,
    ...config,
    features: {
      ...DEFAULT_PORTAL_CONFIG.features,
      ...(config?.features ?? {}),
    },
  }
}

async function hasCommentsFromOthers(
  postId: PostId,
  authorPrincipalId: PrincipalId | null | undefined
): Promise<boolean> {
  if (!authorPrincipalId) return false

  const otherComment = await db.query.comments.findFirst({
    where: and(
      eq(comments.postId, postId),
      sql`${comments.principalId} != ${authorPrincipalId}`,
      isNull(comments.deletedAt)
    ),
  })

  return !!otherComment
}

async function getCommentCount(postId: PostId): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(comments)
    .where(and(eq(comments.postId, postId), isNull(comments.deletedAt)))

  return result[0]?.count ?? 0
}

// ============================================================================
// User Edit/Delete Operations
// ============================================================================

/**
 * User edits their own post
 * Validates permissions and records edit history if enabled
 *
 * @param postId - Post ID to edit
 * @param input - Edit data (title, content, contentJson)
 * @param actor - Actor information (principalId, role)
 * @returns Updated post
 */
export async function userEditPost(
  postId: PostId,
  input: UserEditPostInput,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user' }
): Promise<Post> {
  console.log(
    `[domain:post-user-actions] userEditPost: postId=${postId} principalId=${actor.principalId} role=${actor.role}`
  )
  // Validate input first (no DB needed)
  if (!input.title?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  if (input.title.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must be 200 characters or less')
  }
  if (input.content.length > 10000) {
    throw new ValidationError('VALIDATION_ERROR', 'Content must be 10,000 characters or less')
  }

  // Fetch post with status + portal config in parallel (eliminates duplicate fetches)
  const [existingPost, config] = await Promise.all([
    db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: { postStatus: { columns: { isDefault: true } } },
    }),
    getPortalConfig(),
  ])

  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Check if post is deleted
  if (existingPost.deletedAt) {
    throw new ForbiddenError('EDIT_NOT_ALLOWED', 'Cannot edit a deleted post')
  }

  // Team members (admin, member) can always edit - skip further checks
  if (!isTeamMember(actor.role)) {
    // Must be the author
    if (existingPost.principalId !== actor.principalId) {
      throw new ForbiddenError('EDIT_NOT_ALLOWED', 'You can only edit your own posts')
    }

    // Check engagement restrictions for regular users
    if (!config.features.allowEditAfterEngagement) {
      // Status is default if no statusId or the status has isDefault=true
      const isDefault = !existingPost.statusId || existingPost.postStatus?.isDefault === true
      if (!isDefault) {
        throw new ForbiddenError(
          'EDIT_NOT_ALLOWED',
          'Cannot edit posts that have been reviewed by the team'
        )
      }
      if (existingPost.voteCount > 0) {
        throw new ForbiddenError('EDIT_NOT_ALLOWED', 'Cannot edit posts that have received votes')
      }
      // Check for comments from others
      const hasOtherComments = await hasCommentsFromOthers(postId, actor.principalId)
      if (hasOtherComments) {
        throw new ForbiddenError(
          'EDIT_NOT_ALLOWED',
          'Cannot edit posts that have comments from other users'
        )
      }
    }
  }

  // Record edit history if enabled
  if (config.features.showPublicEditHistory) {
    await db.insert(postEditHistory).values({
      postId: postId,
      editorPrincipalId: actor.principalId,
      previousTitle: existingPost.title,
      previousContent: existingPost.content,
      previousContentJson: existingPost.contentJson,
    })
  }

  // Update the post
  const [updatedPost] = await db
    .update(posts)
    .set({
      title: input.title.trim(),
      content: input.content.trim(),
      contentJson: input.contentJson,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId))
    .returning()

  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Regenerate embedding (and cascade to merge check) after user edit
  import('@/lib/server/domains/embeddings/embedding.service')
    .then(({ generatePostEmbedding }) =>
      generatePostEmbedding(postId, updatedPost.title, updatedPost.content)
    )
    .catch((err) =>
      console.error(`[domain:post-user-actions] Embedding regen failed for ${postId}:`, err)
    )

  return updatedPost
}

/**
 * Soft delete a post
 * Sets deletedAt timestamp, hiding from public views
 *
 * @param postId - Post ID to delete
 * @param actor - Actor information (principalId, role)
 */
export async function softDeletePost(
  postId: PostId,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user'; userId?: UserId }
): Promise<void> {
  console.log(
    `[domain:post-user-actions] softDeletePost: postId=${postId} principalId=${actor.principalId} role=${actor.role}`
  )
  // Fetch post with status + portal config in parallel (eliminates duplicate fetches)
  const [existingPost, config] = await Promise.all([
    db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: { postStatus: { columns: { isDefault: true } } },
    }),
    getPortalConfig(),
  ])

  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Check if post is already deleted
  if (existingPost.deletedAt) {
    throw new ForbiddenError('DELETE_NOT_ALLOWED', 'Post has already been deleted')
  }

  // Team members (admin, member) can always delete - skip further checks
  if (!isTeamMember(actor.role)) {
    // Must be the author
    if (existingPost.principalId !== actor.principalId) {
      throw new ForbiddenError('DELETE_NOT_ALLOWED', 'You can only delete your own posts')
    }

    // Check engagement restrictions for regular users
    if (!config.features.allowDeleteAfterEngagement) {
      // Status is default if no statusId or the status has isDefault=true
      const isDefault = !existingPost.statusId || existingPost.postStatus?.isDefault === true
      if (!isDefault) {
        throw new ForbiddenError(
          'DELETE_NOT_ALLOWED',
          'Cannot delete posts that have been reviewed by the team'
        )
      }
      if (existingPost.voteCount > 0) {
        throw new ForbiddenError(
          'DELETE_NOT_ALLOWED',
          'Cannot delete posts that have received votes'
        )
      }
      // Check for any comments
      const commentCount = await getCommentCount(postId)
      if (commentCount > 0) {
        throw new ForbiddenError('DELETE_NOT_ALLOWED', 'Cannot delete posts that have comments')
      }
    }
  }

  // Set deletedAt and deletedByPrincipalId
  const [updatedPost] = await db
    .update(posts)
    .set({
      deletedAt: new Date(),
      deletedByPrincipalId: actor.principalId,
    })
    .where(eq(posts.id, postId))
    .returning()

  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  createActivity({
    postId,
    principalId: actor.principalId,
    type: 'post.deleted',
  })

  // Dispatch post.deleted event for webhooks and integrations
  const board = await db.query.boards.findFirst({
    where: eq(boards.id, existingPost.boardId),
    columns: { slug: true },
  })
  if (board) {
    dispatchPostDeleted(buildEventActor({ principalId: actor.principalId, userId: actor.userId }), {
      id: postId,
      title: existingPost.title,
      boardId: existingPost.boardId,
      boardSlug: board.slug,
    })
  }
}

/**
 * Restore a soft-deleted post (admin only)
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param postId - Post ID to restore
 * @returns Restored post
 */
export async function restorePost(
  postId: PostId,
  actorPrincipalId?: PrincipalId,
  actorUserId?: UserId
): Promise<Post> {
  console.log(`[domain:post-user-actions] restorePost: postId=${postId}`)
  // Get the post first to validate it exists and is deleted
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (!existingPost.deletedAt) {
    throw new ValidationError('VALIDATION_ERROR', 'Post is not deleted')
  }

  // Enforce 30-day restore window
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  if (new Date(existingPost.deletedAt) < thirtyDaysAgo) {
    throw new ValidationError(
      'RESTORE_EXPIRED',
      'Posts can only be restored within 30 days of deletion'
    )
  }

  // Clear deletedAt and deletedByPrincipalId
  const [restoredPost] = await db
    .update(posts)
    .set({
      deletedAt: null,
      deletedByPrincipalId: null,
    })
    .where(eq(posts.id, postId))
    .returning()

  if (!restoredPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  createActivity({
    postId,
    principalId: actorPrincipalId ?? null,
    type: 'post.restored',
  })

  // Dispatch post.restored event for webhooks and integrations
  if (actorPrincipalId) {
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, restoredPost.boardId),
      columns: { slug: true },
    })
    if (board) {
      dispatchPostRestored(
        buildEventActor({ principalId: actorPrincipalId, userId: actorUserId }),
        {
          id: postId,
          title: restoredPost.title,
          boardId: restoredPost.boardId,
          boardSlug: board.slug,
        }
      )
    }
  }

  return restoredPost
}

/**
 * Permanently delete a post (admin only)
 * This is a hard delete and cannot be undone
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param postId - Post ID to permanently delete
 */
export async function permanentDeletePost(postId: PostId): Promise<void> {
  console.log(`[domain:post-user-actions] permanentDeletePost: postId=${postId}`)
  const [deleted] = await db.delete(posts).where(eq(posts.id, postId)).returning()
  if (!deleted) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }
}
