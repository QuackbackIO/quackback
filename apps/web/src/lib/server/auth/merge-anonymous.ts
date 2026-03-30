/**
 * Shared utility for merging anonymous user activity into an identified user.
 *
 * Used by:
 * - Portal auth: onLinkAccount (anonymous → sign-in to existing account)
 * - Widget identify: previousToken merge (anonymous → SDK re-identify)
 *
 * Transfers: votes, comments, posts, postSubscriptions, inAppNotifications.
 * Cleans up: anonymous principal, sessions, user record.
 */
import type { PrincipalId, UserId } from '@quackback/ids'
import {
  db,
  votes,
  comments,
  posts,
  postSubscriptions,
  inAppNotifications,
  principal,
  session,
  user,
  eq,
  and,
  inArray,
  sql,
} from '@/lib/server/db'

export interface MergeAnonymousParams {
  /** The anonymous principal being merged FROM */
  anonPrincipalId: PrincipalId
  /** The identified principal being merged INTO */
  targetPrincipalId: PrincipalId
  /** The anonymous user ID (for session/user cleanup) */
  anonUserId: UserId
  /** Display name of the anonymous user (for notification title fixup) */
  anonDisplayName: string
  /** Display name of the target user (for notification title fixup) */
  targetDisplayName: string
}

export async function mergeAnonymousToIdentified(params: MergeAnonymousParams): Promise<void> {
  const { anonPrincipalId, targetPrincipalId, anonUserId, anonDisplayName, targetDisplayName } =
    params

  await db.transaction(async (tx) => {
    // 1. Handle vote conflicts: delete anon votes that overlap with target's existing votes
    const existingVotedPostIds = await tx
      .select({ postId: votes.postId })
      .from(votes)
      .where(eq(votes.principalId, targetPrincipalId))

    if (existingVotedPostIds.length > 0) {
      await tx.delete(votes).where(
        and(
          eq(votes.principalId, anonPrincipalId),
          inArray(
            votes.postId,
            existingVotedPostIds.map((v) => v.postId)
          )
        )
      )
    }

    // 2. Get anonymous comment IDs before transfer (for notification cleanup)
    const anonCommentIds = await tx
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.principalId, anonPrincipalId))

    // 3. Transfer votes, comments, posts to target principal
    await Promise.all([
      tx
        .update(votes)
        .set({ principalId: targetPrincipalId })
        .where(eq(votes.principalId, anonPrincipalId)),
      tx
        .update(comments)
        .set({ principalId: targetPrincipalId })
        .where(eq(comments.principalId, anonPrincipalId)),
      tx
        .update(posts)
        .set({ principalId: targetPrincipalId })
        .where(eq(posts.principalId, anonPrincipalId)),
    ])

    // 4. Fix notifications for transferred comments
    if (anonCommentIds.length > 0) {
      const commentIds = anonCommentIds.map((c) => c.id)

      // Delete self-notifications (recipient = target principal, about anonymous comments)
      await tx
        .delete(inAppNotifications)
        .where(
          and(
            eq(inAppNotifications.principalId, targetPrincipalId),
            inArray(inAppNotifications.commentId, commentIds)
          )
        )

      // Update remaining notification titles: replace anonymous name with real name
      const displayName = anonDisplayName || 'Anonymous'
      await tx
        .update(inAppNotifications)
        .set({
          title: sql`REPLACE(${inAppNotifications.title}, ${displayName}, ${targetDisplayName})`,
        })
        .where(inArray(inAppNotifications.commentId, commentIds))
    }

    // 5. Handle subscription conflicts and transfer
    const existingSubPostIds = await tx
      .select({ postId: postSubscriptions.postId })
      .from(postSubscriptions)
      .where(eq(postSubscriptions.principalId, targetPrincipalId))

    if (existingSubPostIds.length > 0) {
      await tx.delete(postSubscriptions).where(
        and(
          eq(postSubscriptions.principalId, anonPrincipalId),
          inArray(
            postSubscriptions.postId,
            existingSubPostIds.map((s) => s.postId)
          )
        )
      )
    }

    // Transfer remaining subscriptions and notifications
    await Promise.all([
      tx
        .update(postSubscriptions)
        .set({ principalId: targetPrincipalId })
        .where(eq(postSubscriptions.principalId, anonPrincipalId)),
      tx
        .update(inAppNotifications)
        .set({ principalId: targetPrincipalId })
        .where(eq(inAppNotifications.principalId, anonPrincipalId)),
    ])

    // 6. Clean up anonymous records: principal first, then sessions and user
    await tx.delete(principal).where(eq(principal.id, anonPrincipalId))
    await Promise.all([
      tx.delete(session).where(eq(session.userId, anonUserId)),
      tx.delete(user).where(eq(user.id, anonUserId)),
    ])
  })
}
