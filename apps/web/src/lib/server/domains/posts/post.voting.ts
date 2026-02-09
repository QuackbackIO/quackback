/**
 * Post Voting Service
 *
 * Handles vote operations for posts with atomic SQL to prevent race conditions.
 */

import { db, posts, votes, postSubscriptions, boards, sql } from '@/lib/server/db'
import { createId, toUuid, type PostId, type PrincipalId } from '@quackback/ids'
import { getExecuteRows } from '@/lib/server/utils'
import { NotFoundError } from '@/lib/shared/errors'
import type { VoteResult } from './post.types'

/**
 * Toggle vote on a post
 *
 * If the user has already voted, removes the vote.
 * If the user hasn't voted, adds a vote.
 *
 * Uses atomic SQL to prevent race conditions and ensure vote count integrity.
 * Only authenticated users can vote (principal_id is required).
 *
 * @param postId - Post ID to vote on
 * @param principalId - Principal ID of the voter (required)
 * @returns Result containing vote status and new count, or an error
 */
export async function voteOnPost(postId: PostId, principalId: PrincipalId): Promise<VoteResult> {
  const postUuid = toUuid(postId)
  const principalUuid = toUuid(principalId)
  const voteId = toUuid(createId('vote'))
  const subscriptionId = toUuid(createId('post_subscription'))

  // Single atomic CTE: validate post/board, toggle vote, update count, auto-subscribe
  // Reduces 5-6 sequential queries to 1
  const result = await db.execute<{
    post_exists: boolean
    board_exists: boolean
    newly_voted: boolean
    vote_count: number
  }>(sql`
    WITH post_check AS (
      SELECT id, board_id, vote_count FROM ${posts}
      WHERE id = ${postUuid}::uuid
    ),
    board_check AS (
      SELECT 1 FROM ${boards}
      WHERE id = (SELECT board_id FROM post_check)
    ),
    existing AS (
      SELECT id FROM ${votes}
      WHERE post_id = ${postUuid}::uuid AND principal_id = ${principalUuid}::uuid
    ),
    deleted AS (
      DELETE FROM ${votes}
      WHERE id IN (SELECT id FROM existing)
      RETURNING id
    ),
    inserted AS (
      INSERT INTO ${votes} (id, post_id, principal_id, updated_at)
      SELECT ${voteId}::uuid, ${postUuid}::uuid, ${principalUuid}::uuid, NOW()
      WHERE NOT EXISTS (SELECT 1 FROM existing)
        AND EXISTS (SELECT 1 FROM post_check)
        AND EXISTS (SELECT 1 FROM board_check)
      ON CONFLICT (post_id, principal_id) DO NOTHING
      RETURNING id
    ),
    updated_post AS (
      UPDATE ${posts}
      SET vote_count = GREATEST(0, vote_count +
        CASE
          WHEN EXISTS (SELECT 1 FROM inserted) THEN 1
          WHEN EXISTS (SELECT 1 FROM deleted) THEN -1
          ELSE 0
        END
      )
      WHERE id = ${postUuid}::uuid
      RETURNING vote_count
    ),
    subscribed AS (
      INSERT INTO ${postSubscriptions} (id, post_id, principal_id, reason, notify_comments, notify_status_changes)
      SELECT ${subscriptionId}::uuid, ${postUuid}::uuid, ${principalUuid}::uuid, 'vote', true, true
      WHERE EXISTS (SELECT 1 FROM inserted)
      ON CONFLICT (post_id, principal_id) DO NOTHING
      RETURNING 1
    )
    SELECT
      EXISTS(SELECT 1 FROM post_check) as post_exists,
      EXISTS(SELECT 1 FROM board_check) as board_exists,
      EXISTS(SELECT 1 FROM inserted) as newly_voted,
      COALESCE((SELECT vote_count FROM updated_post), (SELECT vote_count FROM post_check), 0) as vote_count
  `)

  type VoteResultRow = {
    post_exists: boolean
    board_exists: boolean
    newly_voted: boolean
    vote_count: number
  }
  const rows = getExecuteRows<VoteResultRow>(result)
  const row = rows[0]

  if (!row?.post_exists) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (!row?.board_exists) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board not found for post ${postId}`)
  }

  // newly_voted = true means we inserted a vote (user now has vote)
  // newly_voted = false means we deleted a vote (user no longer has vote)
  const voted = row.newly_voted
  const voteCount = row.vote_count ?? 0

  return { voted, voteCount }
}
