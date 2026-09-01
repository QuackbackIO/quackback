/**
 * UserService - Business logic for portal user management
 *
 * Provides operations for listing and managing portal users (role='user' in principal table).
 * Portal users are authenticated users who can vote/comment on the public portal
 * but don't have admin access (unlike admin/member roles).
 *
 * All users (team + portal) are unified in the principal table with roles:
 * - admin/member: Team members with admin dashboard access
 * - user: Portal users with public portal access only
 */

import {
  db,
  eq,
  and,
  ne,
  or,
  ilike,
  inArray,
  isNull,
  desc,
  asc,
  sql,
  principal,
  user,
  session,
  conversations,
  posts,
  postComments,
  postCommentReactions,
  postVotes,
  conversationMessages,
  userSegments,
  segments,
  userTagAssignments,
  visitorDevices,
} from '@/lib/server/db'
import type { PrincipalId, SegmentId, UserTagId } from '@quackback/ids'
import {
  DELETED_USER_PRINCIPAL_ID,
  reattributeAuthoredContent,
} from '@/lib/server/domains/principals/principal-reattribute'
import { NotFoundError, InternalError } from '@/lib/shared/errors'
import { realEmail } from '@/lib/shared/anonymous-email'
import { logger } from '@/lib/server/logger'
import { resolveUserAvatarUrl } from '@/lib/server/domains/principals/principal-display'

const log = logger.child({ component: 'users' })
import type {
  PortalUserListParams,
  PortalUserListResult,
  PortalUserListItem,
  UserSegmentSummary,
} from './user.types'

/**
 * Fetch segment summaries for a set of principal IDs in a single batch query.
 */
async function fetchSegmentsForPrincipals(
  principalIds: string[]
): Promise<Map<string, UserSegmentSummary[]>> {
  if (principalIds.length === 0) return new Map()

  const rows = await db
    .select({
      principalId: userSegments.principalId,
      segmentId: segments.id,
      segmentName: segments.name,
      segmentColor: segments.color,
      segmentType: segments.type,
    })
    .from(userSegments)
    .innerJoin(segments, eq(userSegments.segmentId, segments.id))
    .where(
      and(
        inArray(userSegments.principalId, principalIds as PrincipalId[]),
        isNull(segments.deletedAt)
      )
    )
    .orderBy(asc(segments.name))

  const map = new Map<string, UserSegmentSummary[]>()
  for (const row of rows) {
    if (!map.has(row.principalId)) map.set(row.principalId, [])
    map.get(row.principalId)!.push({
      id: row.segmentId as SegmentId,
      name: row.segmentName,
      color: row.segmentColor,
      type: row.segmentType as 'manual' | 'dynamic',
    })
  }
  return map
}

/**
 * The canonical lead definition. A lead is an ENGAGED anonymous principal:
 * they authored something (message, post, vote, comment, reaction) or
 * volunteered a contact email. A minted-but-idle anonymous session is a
 * visitor, not a lead, and never appears in the directory (the analytics
 * Visitors section covers that tier). Receiving an agent-started conversation
 * does not qualify either: the visitor becomes a lead when they reply. All
 * the EXISTS probes run on indexed principal_id columns.
 */
export function leadEngagementWhere() {
  return sql`(
    ${principal.contactEmail} IS NOT NULL
    OR EXISTS (SELECT 1 FROM ${conversationMessages} WHERE ${conversationMessages.principalId} = ${principal.id})
    OR EXISTS (SELECT 1 FROM ${posts} WHERE ${posts.principalId} = ${principal.id})
    OR EXISTS (SELECT 1 FROM ${postVotes} WHERE ${postVotes.principalId} = ${principal.id})
    OR EXISTS (SELECT 1 FROM ${postComments} WHERE ${postComments.principalId} = ${principal.id})
    OR EXISTS (SELECT 1 FROM ${postCommentReactions} WHERE ${postCommentReactions.principalId} = ${principal.id})
  )`
}

/**
 * Build a SQL comparison for activity count filters.
 */
function buildCountCondition(countExpr: ReturnType<typeof sql>, op: string, value: number) {
  switch (op) {
    case 'gt':
      return sql`${countExpr} > ${value}`
    case 'gte':
      return sql`${countExpr} >= ${value}`
    case 'lt':
      return sql`${countExpr} < ${value}`
    case 'lte':
      return sql`${countExpr} <= ${value}`
    case 'eq':
      return sql`${countExpr} = ${value}`
    default:
      return sql`${countExpr} >= ${value}`
  }
}

/**
 * List portal users for an organization with activity counts
 *
 * Queries principal table for role='user'.
 * Activity counts use indexed correlated probes so a page does not aggregate
 * the complete posts, comments, votes, sessions, and devices tables.
 *
 * Supports optional filtering by segment IDs (OR logic — users in ANY selected segment).
 */
export async function listPortalUsers(
  params: PortalUserListParams = {}
): Promise<PortalUserListResult> {
  try {
    const {
      search,
      verified,
      dateFrom,
      dateTo,
      emailDomain,
      postCount: postCountFilter,
      voteCount: voteCountFilter,
      commentCount: commentCountFilter,
      customAttrs,
      sort = 'newest',
      page = 1,
      limit = 20,
      segmentIds,
      tagIds,
      lifecycle = 'users',
    } = params

    // Correlated index probes keep the common page query bounded to the
    // filtered principals instead of grouping every row in five whole tables.
    const postCountExpr = sql<number>`(
      SELECT count(*)::int FROM ${posts} activity_posts
      WHERE activity_posts.principal_id = ${principal.id}
        AND activity_posts.deleted_at IS NULL
    )`
    const commentCountExpr = sql<number>`(
      SELECT count(*)::int FROM ${postComments} activity_comments
      WHERE activity_comments.principal_id = ${principal.id}
        AND activity_comments.deleted_at IS NULL
    )`
    const voteCountExpr = sql<number>`(
      SELECT count(*)::int FROM ${postVotes} activity_votes
      WHERE activity_votes.principal_id = ${principal.id}
    )`
    const lastSeenExpr = sql<Date | null>`greatest(
      (SELECT max(activity_sessions.updated_at) FROM ${session} activity_sessions
       WHERE activity_sessions.user_id = ${user.id}),
      (SELECT max(activity_devices.last_seen_at) FROM ${visitorDevices} activity_devices
       WHERE activity_devices.principal_id = ${principal.id})
    )`

    // Build conditions array - filter for role='user' (portal users only)
    const conditions = [eq(principal.role, 'user')]

    // Lifecycle view: identified users by default, engaged anonymous
    // principals (leads) on request. The two views never mix.
    conditions.push(eq(principal.type, lifecycle === 'leads' ? 'anonymous' : 'user'))

    if (lifecycle === 'leads') {
      conditions.push(leadEngagementWhere())
    }

    if (search) {
      conditions.push(
        or(
          ilike(user.name, `%${search}%`),
          ilike(user.email, `%${search}%`),
          ilike(principal.contactEmail, `%${search}%`)
        )!
      )
    }

    if (verified !== undefined) {
      conditions.push(eq(user.emailVerified, verified))
    }

    if (dateFrom) {
      conditions.push(sql`${principal.createdAt} >= ${dateFrom.toISOString()}`)
    }
    if (dateTo) {
      conditions.push(sql`${principal.createdAt} <= ${dateTo.toISOString()}`)
    }

    if (emailDomain) {
      conditions.push(ilike(user.email, `%@${emailDomain}`))
    }

    if (postCountFilter) {
      const { op, value } = postCountFilter
      conditions.push(buildCountCondition(postCountExpr, op, value))
    }
    if (voteCountFilter) {
      const { op, value } = voteCountFilter
      conditions.push(buildCountCondition(voteCountExpr, op, value))
    }
    if (commentCountFilter) {
      const { op, value } = commentCountFilter
      conditions.push(buildCountCondition(commentCountExpr, op, value))
    }

    // Custom attribute filters (metadata JSON fields)
    if (customAttrs && customAttrs.length > 0) {
      for (const attr of customAttrs) {
        const jsonVal = sql`(${user.metadata}::jsonb->>${attr.key})`
        switch (attr.op) {
          case 'eq':
            conditions.push(sql`${jsonVal} = ${attr.value}`)
            break
          case 'neq':
            conditions.push(sql`${jsonVal} != ${attr.value}`)
            break
          case 'contains':
            conditions.push(sql`${jsonVal} ILIKE ${'%' + attr.value + '%'}`)
            break
          case 'starts_with':
            conditions.push(sql`${jsonVal} ILIKE ${attr.value + '%'}`)
            break
          case 'ends_with':
            conditions.push(sql`${jsonVal} ILIKE ${'%' + attr.value}`)
            break
          case 'gt':
            conditions.push(sql`(${jsonVal})::numeric > ${Number(attr.value)}`)
            break
          case 'gte':
            conditions.push(sql`(${jsonVal})::numeric >= ${Number(attr.value)}`)
            break
          case 'lt':
            conditions.push(sql`(${jsonVal})::numeric < ${Number(attr.value)}`)
            break
          case 'lte':
            conditions.push(sql`(${jsonVal})::numeric <= ${Number(attr.value)}`)
            break
          case 'is_set':
            conditions.push(sql`${jsonVal} IS NOT NULL`)
            break
          case 'is_not_set':
            conditions.push(sql`${jsonVal} IS NULL`)
            break
        }
      }
    }

    // Segment filter — OR logic: users in ANY of the selected segments
    if (segmentIds && segmentIds.length > 0) {
      conditions.push(
        inArray(
          principal.id,
          db
            .select({ principalId: userSegments.principalId })
            .from(userSegments)
            .where(inArray(userSegments.segmentId, segmentIds as SegmentId[]))
        )
      )
    }

    // Tag filter — OR logic: users carrying ANY of the selected tags
    if (tagIds && tagIds.length > 0) {
      conditions.push(
        inArray(
          principal.id,
          db
            .select({ principalId: userTagAssignments.principalId })
            .from(userTagAssignments)
            .where(inArray(userTagAssignments.tagId, tagIds as UserTagId[]))
        )
      )
    }

    const whereClause = and(...conditions)

    // Build sort order
    let orderBy
    switch (sort) {
      case 'oldest':
        orderBy = asc(principal.createdAt)
        break
      case 'most_active':
        orderBy = desc(sql`${postCountExpr} + ${commentCountExpr} + ${voteCountExpr}`)
        break
      case 'most_posts':
        orderBy = desc(postCountExpr)
        break
      case 'most_comments':
        orderBy = desc(commentCountExpr)
        break
      case 'most_votes':
        orderBy = desc(voteCountExpr)
        break
      case 'last_active':
        orderBy = sql`${lastSeenExpr} DESC NULLS LAST`
        break
      case 'name':
        orderBy = asc(user.name)
        break
      case 'newest':
      default:
        orderBy = desc(principal.createdAt)
    }

    // Main query plus a matching filtered count.
    const [usersResult, countResult] = await Promise.all([
      db
        .select({
          principalId: principal.id,
          userId: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          imageKey: user.imageKey,
          emailVerified: user.emailVerified,
          metadata: user.metadata,
          principalType: principal.type,
          contactEmail: principal.contactEmail,
          country: user.country,
          joinedAt: principal.createdAt,
          postCount: postCountExpr,
          commentCount: commentCountExpr,
          voteCount: voteCountExpr,
          lastSeenAt: lastSeenExpr,
        })
        .from(principal)
        .innerJoin(user, eq(principal.userId, user.id))
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(principal)
        .innerJoin(user, eq(principal.userId, user.id))
        .where(whereClause),
    ])

    const total = Number(countResult[0]?.count ?? 0)

    // Batch-fetch segments for the returned users
    const segmentMap = await fetchSegmentsForPrincipals(usersResult.map((r) => r.principalId))

    const items: PortalUserListItem[] = usersResult.map((row) => ({
      principalId: row.principalId,
      userId: row.userId,
      name: row.name,
      // Lead rows carry a synthetic account email that must never render;
      // their real identity signal is the captured contactEmail, if any.
      email: realEmail(row.email),
      image: resolveUserAvatarUrl({ userImage: row.image, userImageKey: row.imageKey }),
      emailVerified: row.emailVerified,
      metadata: row.metadata,
      isLead: row.principalType === 'anonymous',
      contactEmail: realEmail(row.contactEmail),
      country: row.country,
      joinedAt: row.joinedAt,
      lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt) : null,
      postCount: Number(row.postCount),
      commentCount: Number(row.commentCount),
      voteCount: Number(row.voteCount),
      segments: segmentMap.get(row.principalId) ?? [],
    }))

    return {
      items,
      total,
      hasMore: page * limit < total,
    }
  } catch (error) {
    log.error({ err: error }, 'failed to list portal users')
    throw new InternalError('DATABASE_ERROR', 'Failed to list portal users', error)
  }
}

/**
 * Remove a portal user from the portal (soft removal).
 *
 * Deletes the `principal` record (role='user') only — the Better-Auth `user`
 * and `account` rows are intentionally retained so we still recognize the
 * person if they return (and their re-join shows distinct "joined" vs
 * "account created" dates). The FK is `principal.userId -> user` with
 * onDelete cascade, so deleting the principal does NOT remove the user; a
 * returning sign-in re-provisions a principal via the SSO hooks or lazily.
 *
 * Their authored content — posts, comments, conversation threads — is
 * re-attributed to the deleted-user placeholder first, in the same
 * transaction: those FKs are ON DELETE RESTRICT, so the delete cannot proceed
 * while the person still owns a row, and discarding the content would tear
 * discussions other people are part of out of context. Everything the schema
 * declares CASCADE or SET NULL (votes, subscriptions, moderation stamps) is
 * left to Postgres. See principals/principal-reattribute.ts for the registry
 * and the audit that keeps it complete.
 *
 * Sessions are revoked and visitor email is cleared in the same transaction
 * so a still-cookied user cannot immediately provision a replacement
 * principal, and inbound mail stops addressing the removed person.
 */
export async function removePortalUser(principalId: PrincipalId): Promise<void> {
  try {
    const existingPrincipal = await db.query.principal.findFirst({
      where: and(
        eq(principal.id, principalId),
        eq(principal.role, 'user'),
        // The placeholder shares role='user' but is not a person. Removing it
        // would re-attribute its content to itself and then strand every
        // earlier removal's content on a deleted row.
        ne(principal.id, DELETED_USER_PRINCIPAL_ID)
      ),
    })

    if (!existingPrincipal) {
      throw new NotFoundError(
        'MEMBER_NOT_FOUND',
        `Portal user with principal ID ${principalId} not found`
      )
    }

    const userId = existingPrincipal.userId

    await db.transaction(async (tx) => {
      await reattributeAuthoredContent(tx, principalId)
      await tx
        .update(conversations)
        .set({ visitorEmail: null })
        .where(eq(conversations.visitorPrincipalId, principalId))
      if (userId) {
        await tx.delete(session).where(eq(session.userId, userId))
      }
      // Delete principal record (user record is retained; the FK cascades the
      // other way, from user to principal)
      await tx.delete(principal).where(eq(principal.id, principalId))
    })

    if (userId) {
      try {
        const { cacheDel, CACHE_KEYS } = await import('@/lib/server/cache')
        await cacheDel(CACHE_KEYS.PRINCIPAL_BY_USER(userId))
      } catch (error) {
        log.warn(
          { err: error, user_id: userId },
          'failed to invalidate principal cache after remove'
        )
      }
    }
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    log.error({ err: error, principalId }, 'failed to remove portal user')
    throw new InternalError('DATABASE_ERROR', 'Failed to remove portal user', error)
  }
}
