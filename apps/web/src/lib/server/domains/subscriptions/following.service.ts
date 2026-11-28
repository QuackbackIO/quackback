/**
 * The posts someone follows, for the portal's Following page (the tickets
 * they watch come from the tickets domain: listWatchedCustomerTickets).
 *
 * Both lists only ever show what the person can see today. A subscription to
 * a post they lost sight of (its board's audience changed) stays in place, as
 * it does for the notification fan-out, but is left out here. A subscription
 * to a post merged into another shows as the surviving post.
 */
import {
  db,
  and,
  eq,
  inArray,
  isNull,
  boards,
  posts,
  postStatuses,
  postSubscriptions,
} from '@/lib/server/db'
import type { PostId } from '@quackback/ids'
import { canViewPost } from '@/lib/server/policy'
import type { Actor } from '@/lib/server/policy/types'
import {
  levelFromFlags,
  type SubscriptionLevel,
  type SubscriptionReason,
} from './subscription.types'

/** A post someone follows, as their Following page lists it. */
export interface FollowedPost {
  postId: PostId
  title: string
  boardSlug: string
  boardName: string
  status: { name: string; color: string } | null
  level: Exclude<SubscriptionLevel, 'none'>
  reason: SubscriptionReason
  followedAt: Date
}

/** The posts `actor` follows and can see, most recently followed first. */
export async function listFollowedPosts(actor: Actor): Promise<FollowedPost[]> {
  const me = actor.principalId
  if (!me) return []
  const subs = await db
    .select({
      postId: postSubscriptions.postId,
      canonicalPostId: posts.canonicalPostId,
      reason: postSubscriptions.reason,
      notifyComments: postSubscriptions.notifyComments,
      notifyStatusChanges: postSubscriptions.notifyStatusChanges,
      createdAt: postSubscriptions.createdAt,
    })
    .from(postSubscriptions)
    .innerJoin(posts, eq(posts.id, postSubscriptions.postId))
    .where(eq(postSubscriptions.principalId, me))
  if (subs.length === 0) return []

  // One row per thread: a follow on a merged source is a follow of the
  // surviving post, at the wider level of the two.
  const byThread = new Map<PostId, (typeof subs)[number] & { threadId: PostId }>()
  for (const sub of subs) {
    const threadId = (sub.canonicalPostId ?? sub.postId) as PostId
    const seen = byThread.get(threadId)
    if (!seen) {
      byThread.set(threadId, { ...sub, threadId })
      continue
    }
    seen.notifyComments ||= sub.notifyComments
    seen.notifyStatusChanges ||= sub.notifyStatusChanges
    if (sub.postId === threadId) seen.reason = sub.reason
    if (sub.createdAt > seen.createdAt) seen.createdAt = sub.createdAt
  }

  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      moderationState: posts.moderationState,
      principalId: posts.principalId,
      boardSlug: boards.slug,
      boardName: boards.name,
      access: boards.access,
      statusName: postStatuses.name,
      statusColor: postStatuses.color,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .where(
      and(
        inArray(posts.id, [...byThread.keys()]),
        isNull(posts.deletedAt),
        isNull(boards.deletedAt)
      )
    )

  const followed: FollowedPost[] = []
  for (const row of rows) {
    const visible = canViewPost(
      actor,
      { moderationState: row.moderationState, principalId: row.principalId },
      { access: row.access }
    ).allowed
    const sub = byThread.get(row.id as PostId)
    if (!visible || !sub) continue
    const level = levelFromFlags(sub.notifyComments, sub.notifyStatusChanges)
    if (level === 'none') continue
    followed.push({
      postId: row.id as PostId,
      title: row.title,
      boardSlug: row.boardSlug,
      boardName: row.boardName,
      status: row.statusName ? { name: row.statusName, color: row.statusColor ?? '' } : null,
      level,
      reason: sub.reason as SubscriptionReason,
      followedAt: sub.createdAt,
    })
  }
  return followed.sort((a, b) => b.followedAt.getTime() - a.followedAt.getTime())
}
