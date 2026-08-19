/**
 * Post Voting Service
 *
 * Handles vote operations for posts with atomic SQL to prevent race conditions.
 */

import {
  db,
  posts,
  postVotes,
  postSubscriptions,
  boards,
  principal,
  user,
  sql,
  eq,
} from '@/lib/server/db'
import { createId, fromUuid, toUuid, type PostId, type PrincipalId } from '@quackback/ids'
import { relatedPostIdsSql } from './post.merge-ids'
import { getExecuteRows } from '@/lib/server/utils'
import { NotFoundError } from '@/lib/shared/errors'
import { realEmail } from '@/lib/shared/anonymous-email'
import { logger } from '@/lib/server/logger'
import { dispatchPostVoted } from '@/lib/server/events/dispatch'
import type { VoteResult } from './post.types'

const log = logger.child({ component: 'post-voting' })

function resolveVotedPostId(resolvedUuid: string | null | undefined, fallback: PostId): PostId {
  if (!resolvedUuid) return fallback
  try {
    return fromUuid('post', resolvedUuid)
  } catch {
    return fallback
  }
}

/**
 * Emit the post.voted event for a freshly cast vote: one indexed lookup for
 * the post ref (title/board slug) joined to the voter's identity, then the
 * usual best-effort dispatch. Anonymous voters contribute no identity — the
 * synthetic placeholder email is stripped here, never on the payload. Best
 * effort end to end: a lookup or dispatch failure is logged and dropped,
 * never fails the vote itself (dispatchEvent already swallows its own
 * failures; this catch covers the lookup).
 */
async function emitPostVotedEvent(
  postId: PostId,
  principalId: PrincipalId,
  voteCount: number
): Promise<void> {
  try {
    const [row] = await db
      .select({
        title: posts.title,
        boardId: posts.boardId,
        boardSlug: boards.slug,
        voterName: principal.displayName,
        voterEmail: user.email,
        voterType: principal.type,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .leftJoin(principal, eq(principal.id, principalId))
      .leftJoin(user, eq(user.id, principal.userId))
      .where(eq(posts.id, postId))
      .limit(1)
    if (!row) return

    const isAnonymous = row.voterType === 'anonymous'
    await dispatchPostVoted(
      {
        type: 'user',
        principalId,
        email: isAnonymous ? undefined : (realEmail(row.voterEmail) ?? undefined),
        displayName: isAnonymous ? undefined : (row.voterName ?? undefined),
      },
      {
        id: postId,
        title: row.title,
        boardId: row.boardId,
        boardSlug: row.boardSlug,
        voterEmail: isAnonymous ? null : realEmail(row.voterEmail),
        voterName: isAnonymous ? null : row.voterName,
        voteCount,
      }
    )
  } catch (error) {
    log.error({ err: error, postId }, 'post.voted event emission failed, dropping')
  }
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
  const voteId = toUuid(createId('post_vote'))
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
      SELECT c.id, c.board_id, c.vote_count
      FROM ${posts} p
      INNER JOIN ${posts} c ON c.id = COALESCE(p.canonical_post_id, p.id)
      WHERE p.id = ${postUuid}::uuid
        AND p.deleted_at IS NULL
        AND c.deleted_at IS NULL
    ),
    board_check AS (
      SELECT 1 FROM ${boards}
      WHERE id = (SELECT board_id FROM post_check)
        AND deleted_at IS NULL
    ),
    existing AS (
      SELECT id FROM ${postVotes}
      WHERE principal_id = ${principalUuid}::uuid
        AND post_id IN ${relatedPostIdsSql(postUuid)}
    ),
    deleted AS (
      DELETE FROM ${postVotes}
      WHERE id IN (SELECT id FROM existing)
        AND EXISTS (SELECT 1 FROM post_check)
        AND EXISTS (SELECT 1 FROM board_check)
      RETURNING id
    ),
    inserted AS (
      INSERT INTO ${postVotes} (id, post_id, principal_id, updated_at)
      SELECT ${voteId}::uuid, (SELECT id FROM post_check), ${principalUuid}::uuid, NOW()
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
      WHERE id = (SELECT id FROM post_check)
      RETURNING vote_count
    ),
    anon_check AS (
      SELECT 1 FROM ${principal} p
      WHERE p.id = ${principalUuid}::uuid AND p.type = 'anonymous'
    ),
    subscribed AS (
      INSERT INTO ${postSubscriptions} (id, post_id, principal_id, reason, notify_comments, notify_status_changes)
      SELECT ${subscriptionId}::uuid, (SELECT id FROM post_check), ${principalUuid}::uuid, 'vote', true, true
      WHERE EXISTS (SELECT 1 FROM inserted)
        AND NOT EXISTS (SELECT 1 FROM anon_check)
      ON CONFLICT (post_id, principal_id) DO NOTHING
      RETURNING 1
    )
    SELECT
      EXISTS(SELECT 1 FROM post_check) as post_exists,
      EXISTS(SELECT 1 FROM board_check) as board_exists,
      EXISTS(SELECT 1 FROM inserted) as newly_voted,
      COALESCE((SELECT vote_count FROM updated_post), (SELECT vote_count FROM post_check), 0) as vote_count,
      (SELECT id FROM post_check) as resolved_post_id
  `)

  type VoteResultRow = {
    post_exists: boolean
    board_exists: boolean
    newly_voted: boolean
    vote_count: number
    resolved_post_id: string | null
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
  const eventPostId = resolveVotedPostId(row.resolved_post_id, postId)

  // post.voted fires only on the insert half of the toggle — an unvote is
  // not a "vote cast" and must not notify subscribed endpoints.
  if (voted) {
    await emitPostVotedEvent(eventPostId, principalId, voteCount)
  }

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
  addedByPrincipalId?: PrincipalId,
  createdAt?: Date
): Promise<VoteResult> {
  const postUuid = toUuid(postId)
  const principalUuid = toUuid(principalId)
  const voteId = toUuid(createId('post_vote'))
  const subscriptionId = toUuid(createId('post_subscription'))

  const sourceType = source?.type ?? null
  const sourceExternalUrl = source?.externalUrl ?? null
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
      SELECT c.id, c.board_id, c.vote_count
      FROM ${posts} p
      INNER JOIN ${posts} c ON c.id = COALESCE(p.canonical_post_id, p.id)
      WHERE p.id = ${postUuid}::uuid
        AND p.deleted_at IS NULL
        AND c.deleted_at IS NULL
    ),
    board_check AS (
      SELECT 1 FROM ${boards}
      WHERE id = (SELECT board_id FROM post_check)
        AND deleted_at IS NULL
    ),
    inserted AS (
      INSERT INTO ${postVotes} (id, post_id, principal_id, source_type, source_external_url, added_by_principal_id, created_at, updated_at)
      SELECT ${voteId}::uuid, (SELECT id FROM post_check), ${principalUuid}::uuid, ${sourceType}, ${sourceExternalUrl}, ${addedByUuid}::uuid, ${createdAtSql}, ${createdAtSql}
      WHERE EXISTS (SELECT 1 FROM post_check)
        AND EXISTS (SELECT 1 FROM board_check)
        AND NOT EXISTS (
          SELECT 1 FROM ${postVotes}
          WHERE principal_id = ${principalUuid}::uuid
            AND post_id IN ${relatedPostIdsSql(postUuid)}
        )
      ON CONFLICT (post_id, principal_id) DO NOTHING
      RETURNING id
    ),
    updated_post AS (
      UPDATE ${posts}
      SET vote_count = GREATEST(0, vote_count + 1)
      WHERE id = (SELECT id FROM post_check)
        AND EXISTS (SELECT 1 FROM inserted)
      RETURNING vote_count
    ),
    subscribed AS (
      INSERT INTO ${postSubscriptions} (id, post_id, principal_id, reason, notify_comments, notify_status_changes)
      SELECT ${subscriptionId}::uuid, (SELECT id FROM post_check), ${principalUuid}::uuid, 'vote', true, true
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
    board_exists: boolean
    deleted: boolean
    vote_count: number
  }>(sql`
    WITH post_check AS (
      SELECT c.id, c.board_id, c.vote_count
      FROM ${posts} p
      INNER JOIN ${posts} c ON c.id = COALESCE(p.canonical_post_id, p.id)
      WHERE p.id = ${postUuid}::uuid
        AND p.deleted_at IS NULL
        AND c.deleted_at IS NULL
    ),
    board_check AS (
      SELECT 1 FROM ${boards}
      WHERE id = (SELECT board_id FROM post_check)
        AND deleted_at IS NULL
    ),
    deleted AS (
      DELETE FROM ${postVotes}
      WHERE principal_id = ${principalUuid}::uuid
        AND post_id IN ${relatedPostIdsSql(postUuid)}
        AND EXISTS (SELECT 1 FROM post_check)
        AND EXISTS (SELECT 1 FROM board_check)
      RETURNING id
    ),
    updated_post AS (
      UPDATE ${posts}
      SET vote_count = GREATEST(0, vote_count - 1)
      WHERE id = (SELECT id FROM post_check)
        AND EXISTS (SELECT 1 FROM deleted)
      RETURNING vote_count
    )
    SELECT
      EXISTS(SELECT 1 FROM post_check) as post_exists,
      EXISTS(SELECT 1 FROM board_check) as board_exists,
      EXISTS(SELECT 1 FROM deleted) as deleted,
      COALESCE((SELECT vote_count FROM updated_post), (SELECT vote_count FROM post_check), 0) as vote_count
  `)

  type RemoveVoteRow = {
    post_exists: boolean
    board_exists: boolean
    deleted: boolean
    vote_count: number
  }
  const rows = getExecuteRows<RemoveVoteRow>(result)
  const row = rows[0]

  if (!row?.post_exists) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (!row?.board_exists) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board not found for post ${postId}`)
  }

  return { removed: row.deleted, voteCount: row.vote_count ?? 0 }
}

export {
  getPostVoters,
  listPostVoters,
  type VoterInfo,
  type ListPostVotersResult,
} from './post.voters'
