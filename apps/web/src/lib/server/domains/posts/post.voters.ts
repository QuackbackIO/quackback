/**
 * Voter listing for a post thread (canonical + merged sources).
 */
import {
  db,
  postVotes,
  postSubscriptions,
  principal,
  user,
  sql,
  eq,
  and,
  desc,
} from '@/lib/server/db'
import { toUuid, type PostId, type PostVoteId, type PrincipalId } from '@quackback/ids'
import { relatedPostIdsSql } from './post.merge-ids'
import { realEmail } from '@/lib/shared/anonymous-email'
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

export interface ListPostVotersResult {
  items: VoterInfo[]
  nextCursor: PostVoteId | null
  hasMore: boolean
}

/**
 * List the voters on a post thread, newest first, with optional keyset
 * pagination. Includes votes cast on posts later merged into this one.
 */
export async function listPostVoters(
  postId: PostId,
  options: { limit?: number; cursor?: PostVoteId } = {}
): Promise<ListPostVotersResult> {
  const { limit, cursor } = options

  // One row per principal (newest vote wins) before keyset pagination, so a
  // person who voted on both the canonical and a source does not consume two
  // page slots or reappear on the next cursor page.
  const conditions = [
    sql`${postVotes.id} IN (
      SELECT DISTINCT ON (v.principal_id) v.id
      FROM ${postVotes} v
      WHERE v.post_id IN ${relatedPostIdsSql(toUuid(postId))}
      ORDER BY v.principal_id, v.created_at DESC, v.id DESC
    )`,
  ]
  if (cursor) {
    const cursorVote = await db.query.postVotes.findFirst({
      where: eq(postVotes.id, cursor),
      columns: { id: true, createdAt: true },
    })
    if (cursorVote) {
      conditions.push(
        sql`(${postVotes.createdAt}, ${postVotes.id}) < (${cursorVote.createdAt.toISOString()}::timestamptz, ${toUuid(cursorVote.id)}::uuid)`
      )
    }
  }

  const query = db
    .select({
      voteId: postVotes.id,
      principalId: principal.id,
      displayName: principal.displayName,
      email: user.email,
      avatarUrl: principal.avatarUrl,
      principalType: principal.type,
      sourceType: postVotes.sourceType,
      sourceExternalUrl: postVotes.sourceExternalUrl,
      addedByName: sql<string | null>`(
        SELECT p2.display_name FROM ${principal} p2
        WHERE p2.id = ${postVotes.addedByPrincipalId}
      )`.as('added_by_name'),
      createdAt: postVotes.createdAt,
      notifyComments: sql<boolean | null>`(
        SELECT bool_or(s.notify_comments)
        FROM ${postSubscriptions} s
        WHERE s.principal_id = ${postVotes.principalId}
          AND s.post_id IN ${relatedPostIdsSql(toUuid(postId))}
      )`.as('notify_comments'),
      notifyStatusChanges: sql<boolean | null>`(
        SELECT bool_or(s.notify_status_changes)
        FROM ${postSubscriptions} s
        WHERE s.principal_id = ${postVotes.principalId}
          AND s.post_id IN ${relatedPostIdsSql(toUuid(postId))}
      )`.as('notify_status_changes'),
    })
    .from(postVotes)
    .innerJoin(principal, eq(principal.id, postVotes.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(and(...conditions))
    .orderBy(desc(postVotes.createdAt), desc(postVotes.id))
    .$dynamic()

  const rows = limit !== undefined ? await query.limit(limit + 1) : await query

  const hasMore = limit !== undefined && rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows

  const items = pageRows.map(mapVoterRow)

  return {
    items,
    nextCursor: hasMore ? pageRows[pageRows.length - 1].voteId : null,
    hasMore,
  }
}

type VoterRow = {
  principalId: PrincipalId
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  principalType: string
  sourceType: string | null
  sourceExternalUrl: string | null
  addedByName: string | null
  createdAt: Date
  notifyComments: boolean | null
  notifyStatusChanges: boolean | null
}

function mapVoterRow(row: VoterRow): VoterInfo {
  const isAnonymous = row.principalType === 'anonymous'
  return {
    principalId: row.principalId,
    displayName: isAnonymous ? null : row.displayName,
    email: realEmail(row.email),
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
}

export async function getPostVoters(postId: PostId): Promise<VoterInfo[]> {
  const { items } = await listPostVoters(postId)
  return items
}
