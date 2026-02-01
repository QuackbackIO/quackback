/**
 * Post Permissions Service
 *
 * Handles user permission checks for editing and deleting their own posts.
 */

import {
  db,
  posts,
  comments,
  postEditHistory,
  eq,
  and,
  sql,
  isNull,
  type Post,
} from '@/lib/server/db'
import { toUuid, type PostId, type MemberId, type StatusId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { DEFAULT_PORTAL_CONFIG, type PortalConfig } from '@/lib/server/domains/settings'
import type { PermissionCheckResult, UserEditPostInput } from './post.types'

// ============================================================================
// Permission Checks
// ============================================================================

/**
 * Check if a user can edit a post
 *
 * @param postId - Post ID to check
 * @param actor - Actor information (memberId, role)
 * @param portalConfig - Optional portal config (will fetch if not provided)
 * @returns Permission check result
 */
export async function canEditPost(
  postId: PostId,
  actor: { memberId: MemberId; role: 'admin' | 'member' | 'user' },
  portalConfig?: PortalConfig
): Promise<PermissionCheckResult> {
  // Get the post
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  })

  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Check if post is deleted
  if (post.deletedAt) {
    return { allowed: false, reason: 'Cannot edit a deleted post' }
  }

  // Team members (admin, member) can always edit
  if (['admin', 'member'].includes(actor.role)) {
    return { allowed: true }
  }

  // Must be the author
  if (post.memberId !== actor.memberId) {
    return { allowed: false, reason: 'You can only edit your own posts' }
  }

  // Get portal config if not provided
  const config = portalConfig ?? (await getPortalConfig())

  // Check if status is default (Open)
  const isDefault = await isDefaultStatus(post.statusId)
  if (!isDefault && !config.features.allowEditAfterEngagement) {
    return { allowed: false, reason: 'Cannot edit posts that have been reviewed by the team' }
  }

  // Check for engagement (votes, comments from others)
  if (!config.features.allowEditAfterEngagement) {
    if (post.voteCount > 0) {
      return { allowed: false, reason: 'Cannot edit posts that have received votes' }
    }

    const hasOtherComments = await hasCommentsFromOthers(postId, actor.memberId)
    if (hasOtherComments) {
      return {
        allowed: false,
        reason: 'Cannot edit posts that have comments from other users',
      }
    }
  }

  return { allowed: true }
}

/**
 * Check if a user can delete a post
 *
 * @param postId - Post ID to check
 * @param actor - Actor information (memberId, role)
 * @param portalConfig - Optional portal config (will fetch if not provided)
 * @returns Permission check result
 */
export async function canDeletePost(
  postId: PostId,
  actor: { memberId: MemberId; role: 'admin' | 'member' | 'user' },
  portalConfig?: PortalConfig
): Promise<PermissionCheckResult> {
  // Get the post
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  })

  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Check if post is already deleted
  if (post.deletedAt) {
    return { allowed: false, reason: 'Post has already been deleted' }
  }

  // Team members (admin, member) can always delete
  if (['admin', 'member'].includes(actor.role)) {
    return { allowed: true }
  }

  // Must be the author
  if (post.memberId !== actor.memberId) {
    return { allowed: false, reason: 'You can only delete your own posts' }
  }

  // Get portal config if not provided
  const config = portalConfig ?? (await getPortalConfig())

  // Check if status is default (Open)
  const isDefault = await isDefaultStatus(post.statusId)
  if (!isDefault && !config.features.allowDeleteAfterEngagement) {
    return {
      allowed: false,
      reason: 'Cannot delete posts that have been reviewed by the team',
    }
  }

  // Check for engagement (votes, comments)
  if (!config.features.allowDeleteAfterEngagement) {
    if (post.voteCount > 0) {
      return { allowed: false, reason: 'Cannot delete posts that have received votes' }
    }

    // Check for any comments (not just from others)
    const commentCount = await getCommentCount(postId)
    if (commentCount > 0) {
      return { allowed: false, reason: 'Cannot delete posts that have comments' }
    }
  }

  return { allowed: true }
}

/**
 * Combined permission check for edit and delete operations.
 * This is more efficient than calling canEditPost and canDeletePost separately
 * because it queries the post, portal config, and status only once.
 *
 * @param postId - Post ID to check
 * @param actor - Actor information (memberId, role)
 * @returns Both edit and delete permission results
 */
export async function getPostPermissions(
  postId: PostId,
  actor: { memberId: MemberId; role: 'admin' | 'member' | 'user' }
): Promise<{
  canEdit: PermissionCheckResult
  canDelete: PermissionCheckResult
}> {
  // Get the post with status in single query (eliminates separate isDefaultStatus query)
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: { postStatus: { columns: { isDefault: true } } },
  })

  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Check if post is deleted - affects both permissions
  if (post.deletedAt) {
    return {
      canEdit: { allowed: false, reason: 'Cannot edit a deleted post' },
      canDelete: { allowed: false, reason: 'Post has already been deleted' },
    }
  }

  // Team members (admin, member) can always edit and delete
  if (['admin', 'member'].includes(actor.role)) {
    return {
      canEdit: { allowed: true },
      canDelete: { allowed: true },
    }
  }

  // For regular users, must be the author
  if (post.memberId !== actor.memberId) {
    return {
      canEdit: { allowed: false, reason: 'You can only edit your own posts' },
      canDelete: { allowed: false, reason: 'You can only delete your own posts' },
    }
  }

  // Get portal config once for both checks
  const config = await getPortalConfig()

  // Status is default if no statusId or the status has isDefault=true
  const isDefault = !post.statusId || post.postStatus?.isDefault === true

  // Initialize results
  let canEdit: PermissionCheckResult = { allowed: true }
  let canDelete: PermissionCheckResult = { allowed: true }

  // Status check for edit
  if (!isDefault && !config.features.allowEditAfterEngagement) {
    canEdit = { allowed: false, reason: 'Cannot edit posts that have been reviewed by the team' }
  }

  // Status check for delete
  if (!isDefault && !config.features.allowDeleteAfterEngagement) {
    canDelete = {
      allowed: false,
      reason: 'Cannot delete posts that have been reviewed by the team',
    }
  }

  // Vote check affects both (if still allowed)
  if (post.voteCount > 0) {
    if (canEdit.allowed && !config.features.allowEditAfterEngagement) {
      canEdit = { allowed: false, reason: 'Cannot edit posts that have received votes' }
    }
    if (canDelete.allowed && !config.features.allowDeleteAfterEngagement) {
      canDelete = { allowed: false, reason: 'Cannot delete posts that have received votes' }
    }
  }

  // Comment checks - use combined query if either check is needed
  const needsEditCommentCheck = canEdit.allowed && !config.features.allowEditAfterEngagement
  const needsDeleteCommentCheck = canDelete.allowed && !config.features.allowDeleteAfterEngagement

  if (needsEditCommentCheck || needsDeleteCommentCheck) {
    // Single query to get both total count and other-user comment count
    const { totalCount, hasOtherComments } = await getCommentStatsForPermissions(
      postId,
      actor.memberId
    )

    if (needsEditCommentCheck && hasOtherComments) {
      canEdit = {
        allowed: false,
        reason: 'Cannot edit posts that have comments from other users',
      }
    }

    if (needsDeleteCommentCheck && totalCount > 0) {
      canDelete = { allowed: false, reason: 'Cannot delete posts that have comments' }
    }
  }

  return { canEdit, canDelete }
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
 * @param actor - Actor information (memberId, role)
 * @returns Updated post
 */
export async function userEditPost(
  postId: PostId,
  input: UserEditPostInput,
  actor: { memberId: MemberId; role: 'admin' | 'member' | 'user' }
): Promise<Post> {
  // Validate input first (no DB needed)
  if (!input.title?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  if (!input.content?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Content is required')
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
  if (!['admin', 'member'].includes(actor.role)) {
    // Must be the author
    if (existingPost.memberId !== actor.memberId) {
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
      const hasOtherComments = await hasCommentsFromOthers(postId, actor.memberId)
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
      editorMemberId: actor.memberId,
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

  return updatedPost
}

/**
 * Soft delete a post
 * Sets deletedAt timestamp, hiding from public views
 *
 * @param postId - Post ID to delete
 * @param actor - Actor information (memberId, role)
 */
export async function softDeletePost(
  postId: PostId,
  actor: { memberId: MemberId; role: 'admin' | 'member' | 'user' }
): Promise<void> {
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
  if (!['admin', 'member'].includes(actor.role)) {
    // Must be the author
    if (existingPost.memberId !== actor.memberId) {
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

  // Set deletedAt and deletedByMemberId
  const [updatedPost] = await db
    .update(posts)
    .set({
      deletedAt: new Date(),
      deletedByMemberId: actor.memberId,
    })
    .where(eq(posts.id, postId))
    .returning()

  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
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
export async function restorePost(postId: PostId): Promise<Post> {
  // Get the post first to validate it exists and is deleted
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (!existingPost.deletedAt) {
    throw new ValidationError('VALIDATION_ERROR', 'Post is not deleted')
  }

  // Clear deletedAt and deletedByMemberId
  const [restoredPost] = await db
    .update(posts)
    .set({
      deletedAt: null,
      deletedByMemberId: null,
    })
    .where(eq(posts.id, postId))
    .returning()

  if (!restoredPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
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
  const [deleted] = await db.delete(posts).where(eq(posts.id, postId)).returning()
  if (!deleted) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }
}

// ============================================================================
// Helper Methods
// ============================================================================

/**
 * Check if a status is the default "open" status
 */
async function isDefaultStatus(statusId: StatusId | null): Promise<boolean> {
  if (!statusId) return true // No status = treat as default

  const { postStatuses, eq, and } = await import('@/lib/server/db')

  const status = await db.query.postStatuses.findFirst({
    where: and(eq(postStatuses.id, statusId), eq(postStatuses.isDefault, true)),
  })

  return !!status
}

/**
 * Check if a post has comments from users other than the author
 */
async function hasCommentsFromOthers(
  postId: PostId,
  authorMemberId: MemberId | null | undefined
): Promise<boolean> {
  if (!authorMemberId) return false // Anonymous author can't have "other" comments

  // Find any comment not from the author and not deleted (LIMIT 1 is faster than COUNT)
  const otherComment = await db.query.comments.findFirst({
    where: and(
      eq(comments.postId, postId),
      sql`${comments.memberId} != ${authorMemberId}`,
      isNull(comments.deletedAt)
    ),
  })

  return !!otherComment
}

/**
 * Get the count of comments on a post (excluding deleted)
 */
async function getCommentCount(postId: PostId): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(comments)
    .where(and(eq(comments.postId, postId), isNull(comments.deletedAt)))

  return result[0]?.count ?? 0
}

/**
 * Combined query to get comment stats for permission checks.
 * Returns both total count and whether there are comments from others in a single query.
 * This is more efficient than calling hasCommentsFromOthers and getCommentCount separately.
 */
async function getCommentStatsForPermissions(
  postId: PostId,
  authorMemberId: MemberId | null | undefined
): Promise<{ totalCount: number; hasOtherComments: boolean }> {
  // Use conditional aggregation to get both values in one query
  const postUuid = toUuid(postId)
  const memberUuid = authorMemberId ? toUuid(authorMemberId) : null

  const result = await db.execute(sql`
    SELECT
      COUNT(*) as total_count,
      COUNT(*) FILTER (WHERE ${comments.memberId} IS NOT NULL AND ${comments.memberId} != ${memberUuid}::uuid) as other_count
    FROM ${comments}
    WHERE ${comments.postId} = ${postUuid}::uuid
      AND ${comments.deletedAt} IS NULL
  `)

  type ResultRow = { total_count: number; other_count: number }
  const rows = getExecuteRows<ResultRow>(result)
  const row = rows[0]
  return {
    totalCount: Number(row?.total_count ?? 0),
    hasOtherComments: Number(row?.other_count ?? 0) > 0,
  }
}

/**
 * Safely extract rows from db.execute() result.
 * Handles both postgres-js (array directly) and neon-http ({ rows: [...] }) formats.
 */
function getExecuteRows<T>(result: unknown): T[] {
  if (
    result &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows
  }
  if (Array.isArray(result)) {
    return result as T[]
  }
  return []
}

/**
 * Get portal config (single workspace mode - returns global config)
 */
async function getPortalConfig(): Promise<PortalConfig> {
  // Get the global settings config
  const org = await db.query.settings.findFirst()

  if (!org?.portalConfig) {
    return DEFAULT_PORTAL_CONFIG
  }

  // Parse the JSON string from database
  let config: Partial<PortalConfig>
  try {
    config = JSON.parse(org.portalConfig) as Partial<PortalConfig>
  } catch {
    return DEFAULT_PORTAL_CONFIG
  }

  // Merge with defaults to ensure all fields exist
  return {
    ...DEFAULT_PORTAL_CONFIG,
    ...config,
    features: {
      ...DEFAULT_PORTAL_CONFIG.features,
      ...(config?.features ?? {}),
    },
  }
}
