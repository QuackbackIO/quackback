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
  postEditHistory,
  postStatuses,
  principal,
  eq,
  type Post,
  type Transaction,
} from '@/lib/server/db'
import { type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { isTeamMember, Role } from '@/lib/shared/roles'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import {
  dispatchPostDeleted,
  dispatchPostRestored,
  buildEventActor,
} from '@/lib/server/events/dispatch'
import { DEFAULT_PORTAL_CONFIG, type PortalConfig } from '@/lib/server/domains/settings'
import type { UserEditPostInput } from './post.types'
import { markdownToTiptapJson, projectContentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
import { authorWindow } from './post.author-window'
import { announceAuthorEdit } from './post.author-edit-announce'
import { contentHoldReason } from '@/lib/server/content/content-holds'
import { recordAuditEvent } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'
import { recalculateCanonicalVoteCount } from './post.merge-ids'

const log = logger.child({ component: 'post-user-actions' })

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
    moderationDefault: {
      ...DEFAULT_PORTAL_CONFIG.moderationDefault,
      ...(config?.moderationDefault ?? {}),
    },
  }
}

/**
 * Who may `action` the post, refused as a typed error: not a deleted post, a
 * team member always, otherwise only its author and only within the author's
 * window (post.author-window.ts). `executor` runs the window's reads on the
 * caller's transaction.
 */
async function assertMayChange(
  action: 'edit' | 'delete',
  post: Post,
  onDefaultStatus: boolean,
  actor: { principalId: PrincipalId; role: Role },
  config: PortalConfig,
  executor: Transaction | typeof db = db
): Promise<void> {
  const code = action === 'edit' ? 'EDIT_NOT_ALLOWED' : 'DELETE_NOT_ALLOWED'
  if (post.deletedAt) {
    throw new ForbiddenError(
      code,
      action === 'edit' ? 'Cannot edit a deleted post' : 'Post has already been deleted'
    )
  }
  if (isTeamMember(actor.role)) return
  if (post.principalId !== actor.principalId) {
    throw new ForbiddenError(code, `You can only ${action} your own posts`)
  }
  const result = await authorWindow(
    action,
    {
      id: post.id as PostId,
      statusId: post.statusId,
      onDefaultStatus,
      canonicalPostId: post.canonicalPostId as PostId | null,
      principalId: post.principalId as PrincipalId | null,
    },
    config,
    executor
  )
  if (!result.allowed) throw new ForbiddenError(code, result.reason ?? 'Not allowed')
}

/**
 * Lock the post row for the rest of `tx` and check again, on what is now
 * there, that `actor` may `action` it. Anything the team does to the post
 * meanwhile (a status change, a reply, which bumps the comment count, a merge)
 * writes this row, so it waits for the lock and the decision cannot go stale
 * between the check and the write.
 */
async function lockAndCheck(
  tx: Transaction,
  postId: PostId,
  action: 'edit' | 'delete',
  actor: { principalId: PrincipalId; role: Role },
  config: PortalConfig
): Promise<Post> {
  const [locked] = await tx.select().from(posts).where(eq(posts.id, postId)).for('update')
  if (!locked) throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  let onDefaultStatus = !locked.statusId
  if (locked.statusId) {
    const [status] = await tx
      .select({ isDefault: postStatuses.isDefault })
      .from(postStatuses)
      .where(eq(postStatuses.id, locked.statusId))
    onDefaultStatus = status?.isDefault === true
  }
  await assertMayChange(action, locked, onDefaultStatus, actor, config, tx)
  return locked
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
  actor: { principalId: PrincipalId; role: Role }
): Promise<Post> {
  log.info({ post_id: postId, principal_id: actor.principalId, role: actor.role }, 'user edit post')
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

  // A first check, so a refused edit copies no images. It is checked again
  // under the row lock below, since copying images can take seconds.
  await assertMayChange(
    'edit',
    existingPost,
    !existingPost.statusId || existingPost.postStatus?.isDefault === true,
    actor,
    config
  )

  const authorIsTeam = isTeamMember(actor.role)
  const nextJson = input.contentJson ?? markdownToTiptapJson(input.content.trim())
  const holdReason = authorIsTeam
    ? null
    : contentHoldReason(
        config.moderationDefault,
        nextJson,
        `${input.title.trim()}\n${input.content.trim()}`
      )

  // Store the document the edit describes, with external images copied in, as
  // creating a post does. The markdown follows the stored document.
  const contentJson = await rehostExternalImages(nextJson, {
    contentType: 'post',
    principalId: existingPost.principalId,
  })

  const { before, updatedPost, rehold } = await db.transaction(async (tx) => {
    const locked = await lockAndCheck(tx, postId, 'edit', actor, config)
    const rehold = Boolean(holdReason && locked.moderationState === 'published')

    // Record edit history if enabled
    if (config.features.showPublicEditHistory) {
      await tx.insert(postEditHistory).values({
        postId: postId,
        editorPrincipalId: actor.principalId,
        previousTitle: locked.title,
        previousContent: locked.content,
        previousContentJson: locked.contentJson,
      })
    }

    const [updated] = await tx
      .update(posts)
      .set({
        title: input.title.trim(),
        content: projectContentJsonToMarkdown(contentJson, input.content.trim()),
        contentJson,
        updatedAt: new Date(),
        ...(rehold ? { moderationState: 'pending' as const } : {}),
      })
      .where(eq(posts.id, postId))
      .returning()
    if (!updated) {
      throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
    }
    return { before: locked, updatedPost: updated, rehold }
  })

  if (rehold) {
    await recordAuditEvent({
      event: 'post.moderation.held',
      actor: { role: actor.role, type: 'user' },
      target: { type: 'post', id: postId },
      after: { moderationState: 'pending' },
      metadata: { reason: holdReason, previouslyPublished: true },
    })
  }

  // Tell integrations and newly mentioned people, as a team edit does, but
  // only for a post others can see. A held post (new, or re-held by this
  // edit) announces itself when it is approved (announcePublishedPost).
  if (updatedPost.moderationState === 'published') {
    await announceAuthorEdit(updatedPost, before, actor)
  }

  // Regenerate embedding (and cascade to merge check) after user edit
  import('@/lib/server/domains/embeddings/embedding.service')
    .then(({ generatePostEmbedding }) =>
      generatePostEmbedding(postId, updatedPost.title, updatedPost.content)
    )
    .catch((err) => log.error({ err, post_id: postId }, 'embedding regen failed'))

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
  actor: { principalId: PrincipalId; role: Role; userId?: UserId },
  beforeDelete?: (tx: import('@/lib/server/db').Transaction) => Promise<void>
): Promise<void> {
  log.info(
    { post_id: postId, principal_id: actor.principalId, role: actor.role },
    'soft delete post'
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

  // Capture selected syncs in the same commit as deletion. A deleted
  // canonical releases its merged duplicates in the same commit: the inbox
  // hides every merged post, so left merged into a deleted post they would
  // vanish. Each released post gets back its own votes and comments. Who may
  // delete is decided under the post row lock, in the same transaction.
  const { updatedPost, released } = await db.transaction(async (tx) => {
    await lockAndCheck(tx, postId, 'delete', actor, config)
    if (beforeDelete) await beforeDelete(tx)
    const [updated] = await tx
      .update(posts)
      .set({ deletedAt: new Date(), deletedByPrincipalId: actor.principalId })
      .where(eq(posts.id, postId))
      .returning()
    if (!updated) return { updatedPost: undefined, released: [] }
    const releasedRows = await tx
      .update(posts)
      .set({
        canonicalPostId: null,
        mergedAt: null,
        mergedByPrincipalId: null,
        mergeCheckedAt: null,
      })
      .where(eq(posts.canonicalPostId, postId))
      .returning({ id: posts.id })
    for (const row of releasedRows) {
      await recalculateCanonicalVoteCount(row.id as PostId, undefined, tx)
    }
    // The canonical no longer carries their votes and comments, so a later
    // restore shows only its own.
    if (releasedRows.length > 0) {
      await recalculateCanonicalVoteCount(postId, undefined, tx)
    }
    return { updatedPost: updated, released: releasedRows.map((r) => r.id as PostId) }
  })

  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  for (const releasedId of released) {
    createActivity({
      postId: releasedId,
      principalId: actor.principalId,
      type: 'post.unmerged',
      metadata: { otherPostId: postId, otherPostTitle: existingPost.title },
    })
  }

  if (existingPost.canonicalPostId) {
    await recalculateCanonicalVoteCount(existingPost.canonicalPostId as PostId)
  }

  createActivity({
    postId,
    principalId: actor.principalId,
    type: 'post.deleted',
  })

  // Dispatch post.deleted event for webhooks and integrations. The deleter is
  // read from their principal, since REST and MCP callers pass only its id,
  // so the event can say who deleted the post (deletedBy).
  const [board, deleter] = await Promise.all([
    db.query.boards.findFirst({
      where: eq(boards.id, existingPost.boardId),
      columns: { slug: true },
    }),
    db.query.principal.findFirst({
      where: eq(principal.id, actor.principalId),
      columns: { userId: true, displayName: true },
      with: { user: { columns: { name: true, email: true } } },
    }),
  ])
  if (board) {
    const eventActor = buildEventActor({
      principalId: actor.principalId,
      userId: actor.userId ?? deleter?.userId ?? undefined,
      email: deleter?.user?.email ?? undefined,
      displayName: deleter?.displayName ?? deleter?.user?.name ?? undefined,
    })
    dispatchPostDeleted(eventActor, {
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
  log.info({ post_id: postId }, 'restore post')
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

  if (restoredPost.canonicalPostId) {
    await recalculateCanonicalVoteCount(restoredPost.canonicalPostId as PostId)
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
  log.info({ post_id: postId }, 'permanent delete post')
  const [deleted] = await db.delete(posts).where(eq(posts.id, postId)).returning()
  if (!deleted) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }
}
