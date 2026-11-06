import { alias } from 'drizzle-orm/pg-core'
import type { PgColumn } from 'drizzle-orm/pg-core'
import {
  and,
  db,
  eq,
  inArray,
  isNotNull,
  posts,
  postSubscriptions,
  postVotes,
  sql,
} from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import type { PublicFeedView } from '@/lib/shared/types/filters'
import type { Actor } from '@/lib/server/policy'

/**
 * The view that applies for this actor. Anonymous sessions have principals
 * too, but no views: a crafted URL falls back to the whole feed rather than
 * an empty one.
 */
export function feedViewFor(
  view: PublicFeedView | undefined,
  actor: Actor
): PublicFeedView | undefined {
  return actor.principalType === 'anonymous' ? undefined : view
}

/** A merged-away post, read for the post it was merged into. */
const merged = alias(posts, 'merged')

/**
 * Posts the viewer has a relationship with (a vote, a subscription), read
 * through merges: a vote stays on the post it was cast on after that post is
 * merged away, and the feed lists only the post it went into.
 */
function relatedPosts(postId: PgColumn, principalId: PgColumn, viewer: PrincipalId) {
  const table = postId.table
  const direct = db.select({ id: postId }).from(table).where(eq(principalId, viewer))
  const mergedInto = db
    .select({ id: merged.canonicalPostId })
    .from(table)
    .innerJoin(merged, eq(merged.id, postId))
    .where(and(eq(principalId, viewer), isNotNull(merged.canonicalPostId)))
  return sql`(${inArray(posts.id, direct)} OR ${inArray(posts.id, mergedInto)})`
}

/** The posts in a viewer's own feed view, keyed off the actor, never the client. */
export function feedViewCondition(view: PublicFeedView, viewer: PrincipalId) {
  switch (view) {
    case 'mine':
      return eq(posts.principalId, viewer)
    case 'voted':
      return relatedPosts(postVotes.postId, postVotes.principalId, viewer)
    case 'following':
      return relatedPosts(postSubscriptions.postId, postSubscriptions.principalId, viewer)
  }
}
