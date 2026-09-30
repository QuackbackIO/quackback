import { and, db, inArray, ne, postVotes } from '@/lib/server/db'
import type { PostId, PrincipalId } from '@quackback/ids'
import { relatedPostIdsSubquery } from './post.merge-ids'

/**
 * Return whether anyone other than the post author has voted on the post
 * thread. New posts are automatically upvoted by their author, so the stored
 * vote count alone cannot distinguish that initial vote from engagement by
 * another person.
 */
export async function hasVotesFromOtherUsers(
  postId: PostId,
  authorPrincipalId: PrincipalId
): Promise<boolean> {
  const otherVote = await db.query.postVotes.findFirst({
    columns: { id: true },
    where: and(
      inArray(postVotes.postId, relatedPostIdsSubquery(postId)),
      ne(postVotes.principalId, authorPrincipalId)
    ),
  })

  return Boolean(otherVote)
}
