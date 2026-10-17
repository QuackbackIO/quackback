import { db, eq, inArray, posts, postSubscriptions, postVotes } from '@/lib/server/db'
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

/** The posts in a viewer's own feed view, keyed off the actor, never the client. */
export function feedViewCondition(view: PublicFeedView, viewer: PrincipalId) {
  switch (view) {
    case 'mine':
      return eq(posts.principalId, viewer)
    case 'voted':
      return inArray(
        posts.id,
        db
          .select({ postId: postVotes.postId })
          .from(postVotes)
          .where(eq(postVotes.principalId, viewer))
      )
    case 'following':
      return inArray(
        posts.id,
        db
          .select({ postId: postSubscriptions.postId })
          .from(postSubscriptions)
          .where(eq(postSubscriptions.principalId, viewer))
      )
  }
}
