/**
 * Activity Service - Post activity log CRUD
 *
 * Records meaningful state changes on posts: status transitions, merges,
 * tag changes, owner assignments, etc. Activity inserts are fire-and-forget
 * and should never block or fail the parent operation.
 */

import { db, postActivity, eq, desc, principal as principalTable } from '@/lib/server/db'
import type { PostId, PrincipalId } from '@featurepool/ids'

// ============================================
// Types
// ============================================

export type ActivityType =
  | 'post.created'
  | 'post.deleted'
  | 'post.restored'
  | 'status.changed'
  | 'post.board_changed'
  | 'post.merged_in'
  | 'post.merged_away'
  | 'post.unmerged'
  | 'vote.proxy'
  | 'vote.removed'
  | 'owner.assigned'
  | 'owner.unassigned'
  | 'tags.added'
  | 'tags.removed'
  | 'roadmap.added'
  | 'roadmap.removed'
  | 'comments.locked'
  | 'comments.unlocked'
  | 'comment.pinned'
  | 'comment.unpinned'
  | 'comment.deleted'
  | 'comment.removed'
  | 'comment.restored'

export interface CreateActivityOpts {
  postId: PostId
  principalId: PrincipalId | null
  type: ActivityType
  metadata?: Record<string, unknown>
}

export interface ActivityRow {
  id: string
  postId: string
  principalId: string | null
  type: ActivityType
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>
  createdAt: Date
  actorName: string | null
}

// ============================================
// Create
// ============================================

/**
 * Record a post activity event. Fire-and-forget - never throws.
 */
export function createActivity(opts: CreateActivityOpts): void {
  db.insert(postActivity)
    .values({
      postId: opts.postId,
      principalId: opts.principalId,
      type: opts.type,
      metadata: opts.metadata ?? {},
    })
    .catch((err) => {
      console.error(`[domain:activity] failed to create activity: type=${opts.type}`, err)
    })
}

// ============================================
// Query
// ============================================

/**
 * Get activity for a post, ordered by creation time (newest first).
 * Resolves actor names from the principal table.
 * Limited to 200 most recent entries to prevent unbounded growth.
 */
export async function getActivityForPost(postId: PostId): Promise<ActivityRow[]> {
  const rows = await db
    .select({
      id: postActivity.id,
      postId: postActivity.postId,
      principalId: postActivity.principalId,
      type: postActivity.type,
      metadata: postActivity.metadata,
      createdAt: postActivity.createdAt,
      actorName: principalTable.displayName,
    })
    .from(postActivity)
    .leftJoin(principalTable, eq(postActivity.principalId, principalTable.id))
    .where(eq(postActivity.postId, postId))
    .orderBy(desc(postActivity.createdAt))
    .limit(200)

  return rows as ActivityRow[]
}
