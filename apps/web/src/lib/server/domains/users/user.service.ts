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
  or,
  ilike,
  inArray,
  isNull,
  desc,
  asc,
  sql,
  principal,
  user,
  posts,
  comments,
  votes,
  userSegments,
  segments,
} from '@/lib/server/db'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import { NotFoundError, InternalError } from '@/lib/shared/errors'
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
 * Activity counts are computed via efficient LEFT JOINs with pre-aggregated subqueries,
 * using the indexed principal_id columns on posts, comments, and votes tables.
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
    } = params

    // Pre-aggregate activity counts in subqueries (executed once, not per-row)
    // These use the indexed principal_id columns for efficient lookups
    // Each count column has a unique name to avoid ambiguity in the final SELECT
    const postCounts = db
      .select({
        principalId: posts.principalId,
        postCount: sql<number>`count(*)::int`.as('post_count'),
      })
      .from(posts)
      .where(isNull(posts.deletedAt))
      .groupBy(posts.principalId)
      .as('post_counts')

    const commentCounts = db
      .select({
        principalId: comments.principalId,
        commentCount: sql<number>`count(*)::int`.as('comment_count'),
      })
      .from(comments)
      .where(isNull(comments.deletedAt))
      .groupBy(comments.principalId)
      .as('comment_counts')

    const voteCounts = db
      .select({
        principalId: votes.principalId,
        voteCount: sql<number>`count(*)::int`.as('vote_count'),
      })
      .from(votes)
      .groupBy(votes.principalId)
      .as('vote_counts')

    // Build conditions array - filter for role='user' (portal users only)
    const conditions = [eq(principal.role, 'user')]

    if (search) {
      conditions.push(or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))!)
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
      const countExpr = sql`COALESCE(${postCounts.postCount}, 0)`
      conditions.push(buildCountCondition(countExpr, op, value))
    }
    if (voteCountFilter) {
      const { op, value } = voteCountFilter
      const countExpr = sql`COALESCE(${voteCounts.voteCount}, 0)`
      conditions.push(buildCountCondition(countExpr, op, value))
    }
    if (commentCountFilter) {
      const { op, value } = commentCountFilter
      const countExpr = sql`COALESCE(${commentCounts.commentCount}, 0)`
      conditions.push(buildCountCondition(countExpr, op, value))
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

    const whereClause = and(...conditions)

    // Build sort order
    let orderBy
    switch (sort) {
      case 'oldest':
        orderBy = asc(principal.createdAt)
        break
      case 'most_active':
        orderBy = desc(
          sql`COALESCE(${postCounts.postCount}, 0) + COALESCE(${commentCounts.commentCount}, 0) + COALESCE(${voteCounts.voteCount}, 0)`
        )
        break
      case 'most_posts':
        orderBy = desc(sql`COALESCE(${postCounts.postCount}, 0)`)
        break
      case 'most_comments':
        orderBy = desc(sql`COALESCE(${commentCounts.commentCount}, 0)`)
        break
      case 'most_votes':
        orderBy = desc(sql`COALESCE(${voteCounts.voteCount}, 0)`)
        break
      case 'name':
        orderBy = asc(user.name)
        break
      case 'newest':
      default:
        orderBy = desc(principal.createdAt)
    }

    // Main query with LEFT JOINs to pre-aggregated counts
    const [usersResult, countResult] = await Promise.all([
      db
        .select({
          principalId: principal.id,
          userId: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          emailVerified: user.emailVerified,
          metadata: user.metadata,
          joinedAt: principal.createdAt,
          postCount: sql<number>`COALESCE(${postCounts.postCount}, 0)`,
          commentCount: sql<number>`COALESCE(${commentCounts.commentCount}, 0)`,
          voteCount: sql<number>`COALESCE(${voteCounts.voteCount}, 0)`,
        })
        .from(principal)
        .innerJoin(user, eq(principal.userId, user.id))
        .leftJoin(postCounts, eq(postCounts.principalId, principal.id))
        .leftJoin(commentCounts, eq(commentCounts.principalId, principal.id))
        .leftJoin(voteCounts, eq(voteCounts.principalId, principal.id))
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit)
        .offset((page - 1) * limit),
      // Count query needs the same JOINs when activity count filters are used
      postCountFilter || voteCountFilter || commentCountFilter
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(principal)
            .innerJoin(user, eq(principal.userId, user.id))
            .leftJoin(postCounts, eq(postCounts.principalId, principal.id))
            .leftJoin(commentCounts, eq(commentCounts.principalId, principal.id))
            .leftJoin(voteCounts, eq(voteCounts.principalId, principal.id))
            .where(whereClause)
        : db
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
      email: row.email,
      image: row.image,
      emailVerified: row.emailVerified,
      metadata: row.metadata,
      joinedAt: row.joinedAt,
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
    console.error('Error listing portal users:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to list portal users', error)
  }
}

/**
 * Remove a portal user from an organization
 *
 * Deletes the principal record with role='user'.
 * Since users are org-scoped, this also deletes the user record (CASCADE).
 */
export async function removePortalUser(principalId: PrincipalId): Promise<void> {
  try {
    // Verify principal exists and has role='user'
    const existingPrincipal = await db.query.principal.findFirst({
      where: and(eq(principal.id, principalId), eq(principal.role, 'user')),
    })

    if (!existingPrincipal) {
      throw new NotFoundError(
        'MEMBER_NOT_FOUND',
        `Portal user with principal ID ${principalId} not found`
      )
    }

    // Delete principal record (user record will be deleted via CASCADE since user is org-scoped)
    await db.delete(principal).where(eq(principal.id, principalId))
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    console.error('Error removing portal user:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to remove portal user', error)
  }
}
