/**
 * Post Voting Service
 *
 * Handles vote operations for posts with atomic SQL to prevent race conditions.
 */

import {
  db,
  posts,
  votes,
  postSubscriptions,
  boards,
  principal,
  user,
  sql,
  eq,
  and,
  desc,
} from '@/lib/server/db'
import { createId, toUuid, type PostId, type PrincipalId } from '@featurepool/ids'
import { getExecuteRows } from '@/lib/server/utils'
import { NotFoundError } from '@/lib/shared/errors'
import type { VoteResult } from './post.types'
import {
  levelFromFlags,
  type SubscriptionLevel,
} from '@/lib/server/domains/subscriptions/subscription.types'

export interface VoterInfo {
  principalId: string
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  isAnonymous: boolean
  sourceType: string | null
  sourceExternalUrl: string | null
  addedByName: string | null
  createdAt: Date | string
  subscriptionLevel: SubscriptionLevel
}

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
      WHERE id = ${postUuid}::uuid AND deleted_at IS NULL
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
    anon_check AS (
      SELECT 1 FROM ${principal} p
      WHERE p.id = ${principalUuid}::uuid AND p.type = 'anonymous'
    ),
    subscribed AS (
      INSERT INTO ${postSubscriptions} (id, post_id, principal_id, reason, notify_comments, notify_status_changes)
      SELECT ${subscriptionId}::uuid, ${postUuid}::uuid, ${principalUuid}::uuid, 'vote', true, true
      WHERE EXISTS (SELECT 1 FROM inserted)
        AND NOT EXISTS (SELECT 1 FROM anon_check)
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

/**
 * Add a vote on behalf of a user (insert-only, never removes)
 *
 * Used by integration apps (e.g. Zendesk sidebar) to vote on behalf of
 * a customer when linking a ticket to a post. Unlike voteOnPost(), this
 * is idempotent and never toggles — it only inserts.
 *
 * @param postId - Post ID to vote on
 * @param principalId - Principal ID of the voter
 * @param source - Optional source metadata (e.g. { type: 'zendesk', externalUrl: 'https://...' })
 * @returns Result containing vote status and new count
 */
export async function addVoteOnBehalf(
  postId: PostId,
  principalId: PrincipalId,
  source?: { type: string; externalUrl: string },
  feedbackSuggestionId?: string | null,
  addedByPrincipalId?: PrincipalId,
  createdAt?: Date
): Promise<VoteResult> {
  const postUuid = toUuid(postId)
  const principalUuid = toUuid(principalId)
  const voteId = toUuid(createId('vote'))
  const subscriptionId = toUuid(createId('post_subscription'))

  const sourceType = source?.type ?? null
  const sourceExternalUrl = source?.externalUrl ?? null
  const suggestionUuid = feedbackSuggestionId ? toUuid(feedbackSuggestionId) : null
  const addedByUuid = addedByPrincipalId ? toUuid(addedByPrincipalId) : null
  const createdAtSql = createdAt ? sql`${createdAt.toISOString()}::timestamptz` : sql`NOW()`

  // Single atomic CTE: validate post/board, insert vote (never delete), update count, auto-subscribe
  const result = await db.execute<{
    post_exists: boolean
    board_exists: boolean
    newly_voted: boolean
    vote_count: number
  }>(sql`
    WITH post_check AS (
      SELECT id, board_id, vote_count FROM ${posts}
      WHERE id = ${postUuid}::uuid AND deleted_at IS NULL
    ),
    board_check AS (
      SELECT 1 FROM ${boards}
      WHERE id = (SELECT board_id FROM post_check)
    ),
    inserted AS (
      INSERT INTO ${votes} (id, post_id, principal_id, source_type, source_external_url, feedback_suggestion_id, added_by_principal_id, created_at, updated_at)
      SELECT ${voteId}::uuid, ${postUuid}::uuid, ${principalUuid}::uuid, ${sourceType}, ${sourceExternalUrl}, ${suggestionUuid}::uuid, ${addedByUuid}::uuid, ${createdAtSql}, ${createdAtSql}
      WHERE EXISTS (SELECT 1 FROM post_check)
        AND EXISTS (SELECT 1 FROM board_check)
      ON CONFLICT (post_id, principal_id) DO NOTHING
      RETURNING id
    ),
    updated_post AS (
      UPDATE ${posts}
      SET vote_count = GREATEST(0, vote_count + 1)
      WHERE id = ${postUuid}::uuid
        AND EXISTS (SELECT 1 FROM inserted)
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

  return { voted: row.newly_voted, voteCount: row.vote_count ?? 0 }
}

/**
 * Remove a vote from a post (any source: proxy, integration, or direct)
 *
 * Used by admins to rescind any vote from the voter list.
 * Does NOT remove the voter's subscription.
 *
 * @param postId - Post ID to remove vote from
 * @param principalId - Principal ID of the voter whose vote to remove
 * @returns Result containing whether a vote was removed and new count
 */
export async function removeVote(
  postId: PostId,
  principalId: PrincipalId
): Promise<{ removed: boolean; voteCount: number }> {
  const postUuid = toUuid(postId)
  const principalUuid = toUuid(principalId)

  const result = await db.execute<{
    post_exists: boolean
    deleted: boolean
    vote_count: number
  }>(sql`
    WITH post_check AS (
      SELECT id, vote_count FROM ${posts}
      WHERE id = ${postUuid}::uuid AND deleted_at IS NULL
    ),
    deleted AS (
      DELETE FROM ${votes}
      WHERE post_id = ${postUuid}::uuid
        AND principal_id = ${principalUuid}::uuid
        AND EXISTS (SELECT 1 FROM post_check)
      RETURNING id
    ),
    updated_post AS (
      UPDATE ${posts}
      SET vote_count = GREATEST(0, vote_count - 1)
      WHERE id = ${postUuid}::uuid
        AND EXISTS (SELECT 1 FROM deleted)
      RETURNING vote_count
    )
    SELECT
      EXISTS(SELECT 1 FROM post_check) as post_exists,
      EXISTS(SELECT 1 FROM deleted) as deleted,
      COALESCE((SELECT vote_count FROM updated_post), (SELECT vote_count FROM post_check), 0) as vote_count
  `)

  type RemoveVoteRow = {
    post_exists: boolean
    deleted: boolean
    vote_count: number
  }
  const rows = getExecuteRows<RemoveVoteRow>(result)
  const row = rows[0]

  if (!row?.post_exists) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  return { removed: row.deleted, voteCount: row.vote_count ?? 0 }
}

/**
 * Get all voters for a post with their identity and source attribution.
 * Returns newest votes first.
 */
export async function getPostVoters(postId: PostId): Promise<VoterInfo[]> {
  const rows = await db
    .select({
      principalId: principal.id,
      displayName: principal.displayName,
      email: user.email,
      avatarUrl: principal.avatarUrl,
      principalType: principal.type,
      sourceType: votes.sourceType,
      sourceExternalUrl: votes.sourceExternalUrl,
      addedByName: sql<string | null>`(
        SELECT p2.display_name FROM ${principal} p2
        WHERE p2.id = ${votes.addedByPrincipalId}
      )`.as('added_by_name'),
      createdAt: votes.createdAt,
      notifyComments: postSubscriptions.notifyComments,
      notifyStatusChanges: postSubscriptions.notifyStatusChanges,
    })
    .from(votes)
    .innerJoin(principal, eq(principal.id, votes.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .leftJoin(
      postSubscriptions,
      and(
        eq(postSubscriptions.postId, votes.postId),
        eq(postSubscriptions.principalId, votes.principalId)
      )
    )
    .where(eq(votes.postId, postId))
    .orderBy(desc(votes.createdAt))

  return rows.map((row) => {
    const isAnonymous = row.principalType === 'anonymous'
    return {
      principalId: row.principalId,
      displayName: isAnonymous ? null : row.displayName,
      email: row.email,
      avatarUrl: isAnonymous ? null : row.avatarUrl,
      isAnonymous,
      sourceType: row.sourceType,
      sourceExternalUrl: row.sourceExternalUrl,
      addedByName: row.addedByName,
      createdAt: row.createdAt,
      subscriptionLevel: isAnonymous
        ? ('none' as const)
        : levelFromFlags(row.notifyComments ?? false, row.notifyStatusChanges ?? false),
    }
  })
}
