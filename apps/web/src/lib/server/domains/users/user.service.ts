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
  postStatuses,
  boards,
  userSegments,
  segments,
} from '@/lib/server/db'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import { NotFoundError, InternalError } from '@/lib/shared/errors'
import type {
  PortalUserListParams,
  PortalUserListResult,
  PortalUserListItem,
  PortalUserDetail,
  EngagedPost,
  EngagementType,
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
    const { search, verified, dateFrom, dateTo, sort = 'newest', page = 1, limit = 20, segmentIds } = params

    // Pre-aggregate activity counts in subqueries (executed once, not per-row)
    // These use the indexed principal_id columns for efficient lookups
    // Note: We join with boards to filter by workspace
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

    // Comments are linked to posts, which are linked to boards
    const commentCounts = db
      .select({
        principalId: comments.principalId,
        commentCount: sql<number>`count(*)::int`.as('comment_count'),
      })
      .from(comments)
      .where(isNull(comments.deletedAt))
      .groupBy(comments.principalId)
      .as('comment_counts')

    // Votes are linked to posts, which are linked to boards
    // Use votes.principal_id (indexed) instead of string concatenation on user_identifier
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

    // Search filter (name or email)
    if (search) {
      conditions.push(or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))!)
    }

    // Verified filter
    if (verified !== undefined) {
      conditions.push(eq(user.emailVerified, verified))
    }

    // Date range filters (on principal.createdAt = join date)
    if (dateFrom) {
      conditions.push(sql`${principal.createdAt} >= ${dateFrom}`)
    }
    if (dateTo) {
      conditions.push(sql`${principal.createdAt} <= ${dateTo}`)
    }

    // Segment filter — OR logic: users in ANY of the selected segments
    if (segmentIds && segmentIds.length > 0) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM user_segments us
          WHERE us.principal_id = ${principal.id}
            AND us.segment_id = ANY(${sql.raw(`ARRAY[${segmentIds.map(() => '?').join(',')}]`)}::text[])
        )`
      )
      // Use inArray subquery instead for proper parameterization
      conditions.pop()
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

    // Build sort order - now references the joined count columns
    let orderBy
    switch (sort) {
      case 'oldest':
        orderBy = asc(principal.createdAt)
        break
      case 'most_active':
        // Sort by total activity using the pre-joined counts
        orderBy = desc(
          sql`COALESCE(${postCounts.postCount}, 0) + COALESCE(${commentCounts.commentCount}, 0) + COALESCE(${voteCounts.voteCount}, 0)`
        )
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
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(principal)
        .innerJoin(user, eq(principal.userId, user.id))
        .where(whereClause),
    ])

    const rawUsers = usersResult
    const total = Number(countResult[0]?.count ?? 0)

    // Batch-fetch segments for the returned users
    const principalIdList = rawUsers.map((r) => r.principalId)
    const segmentMap = await fetchSegmentsForPrincipals(principalIdList)

    const items: PortalUserListItem[] = rawUsers.map((row) => ({
      principalId: row.principalId,
      userId: row.userId,
      name: row.name,
      email: row.email,
      image: row.image,
      emailVerified: row.emailVerified,
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
 * Get detailed information about a portal user including their activity
 *
 * Returns user info and all posts they've engaged with (authored, commented on, or voted on).
 */
export async function getPortalUserDetail(
  principalId: PrincipalId
): Promise<PortalUserDetail | null> {
  try {
    // Get principal with user details (filter for role='user')
    const principalResult = await db
      .select({
        principalId: principal.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        emailVerified: user.emailVerified,
        joinedAt: principal.createdAt,
        createdAt: user.createdAt,
      })
      .from(principal)
      .innerJoin(user, eq(principal.userId, user.id))
      .where(and(eq(principal.id, principalId), eq(principal.role, 'user')))
      .limit(1)

    if (principalResult.length === 0) {
      return null
    }

    const principalData = principalResult[0]
    // principalData.principalId is already in PrincipalId format from the query
    const principalIdForQuery = principalData.principalId

    // Run independent queries in parallel for better performance
    const [authoredPosts, commentedPostIds, votedPostIds] = await Promise.all([
      // Get posts authored by this user (via principalId)
      db
        .select({
          id: posts.id,
          title: posts.title,
          content: posts.content,
          statusId: posts.statusId,
          voteCount: posts.voteCount,
          createdAt: posts.createdAt,
          authorName: sql<string | null>`(
            SELECT m.display_name FROM ${principal} m
            WHERE m.id = ${posts.principalId}
          )`.as('author_name'),
          boardSlug: boards.slug,
          boardName: boards.name,
          statusName: postStatuses.name,
          statusColor: postStatuses.color,
        })
        .from(posts)
        .innerJoin(boards, eq(posts.boardId, boards.id))
        .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
        .where(and(eq(posts.principalId, principalIdForQuery), isNull(posts.deletedAt)))
        .orderBy(desc(posts.createdAt))
        .limit(100),

      // Get post IDs the user has commented on (via principalId)
      // Join to posts to exclude deleted posts before the limit
      db
        .select({
          postId: comments.postId,
          latestCommentAt: sql<Date>`max(${comments.createdAt})`.as('latest_comment_at'),
        })
        .from(comments)
        .innerJoin(posts, eq(posts.id, comments.postId))
        .where(and(eq(comments.principalId, principalIdForQuery), isNull(posts.deletedAt)))
        .groupBy(comments.postId)
        .limit(100),

      // Get post IDs the user has voted on (via indexed principalId column)
      // Join to posts to exclude deleted posts before the limit
      db
        .select({
          postId: votes.postId,
          votedAt: votes.createdAt,
        })
        .from(votes)
        .innerJoin(posts, eq(posts.id, votes.postId))
        .where(and(eq(votes.principalId, principalIdForQuery), isNull(posts.deletedAt)))
        .orderBy(desc(votes.createdAt))
        .limit(100),
    ])

    // Collect all unique post IDs that aren't authored by user (for fetching additional posts)
    const authoredIds = new Set(authoredPosts.map((p) => p.id))
    const otherPostIds = [
      ...new Set([
        ...commentedPostIds.map((c) => c.postId).filter((id) => !authoredIds.has(id)),
        ...votedPostIds.map((v) => v.postId).filter((id) => !authoredIds.has(id)),
      ]),
    ]

    // Run the dependent queries in parallel where possible
    const [otherPosts, commentCounts] = await Promise.all([
      // Fetch posts the user engaged with but didn't author
      otherPostIds.length > 0
        ? db
            .select({
              id: posts.id,
              title: posts.title,
              content: posts.content,
              statusId: posts.statusId,
              voteCount: posts.voteCount,
              createdAt: posts.createdAt,
              authorName: sql<string | null>`(
                SELECT m.display_name FROM ${principal} m
                WHERE m.id = ${posts.principalId}
              )`.as('author_name'),
              boardSlug: boards.slug,
              boardName: boards.name,
              statusName: postStatuses.name,
              statusColor: postStatuses.color,
            })
            .from(posts)
            .innerJoin(boards, eq(posts.boardId, boards.id))
            .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
            .where(and(inArray(posts.id, otherPostIds), isNull(posts.deletedAt)))
        : Promise.resolve([]),

      // Get comment counts for authored posts (we'll add otherPosts counts after)
      authoredPosts.length > 0
        ? db
            .select({
              postId: comments.postId,
              count: sql<number>`count(*)::int`.as('count'),
            })
            .from(comments)
            .where(
              and(
                inArray(
                  comments.postId,
                  authoredPosts.map((p) => p.id)
                ),
                isNull(comments.deletedAt)
              )
            )
            .groupBy(comments.postId)
        : Promise.resolve([]),
    ])

    // Get comment counts for other posts if we have any
    const otherPostCommentCounts =
      otherPosts.length > 0
        ? await db
            .select({
              postId: comments.postId,
              count: sql<number>`count(*)::int`.as('count'),
            })
            .from(comments)
            .where(
              and(
                inArray(
                  comments.postId,
                  otherPosts.map((p) => p.id)
                ),
                isNull(comments.deletedAt)
              )
            )
            .groupBy(comments.postId)
        : []

    const engagementData = {
      authoredPosts,
      commentedPostIds,
      votedPostIds,
      otherPosts,
      commentCounts: [...commentCounts, ...otherPostCommentCounts],
    }

    // Build maps for engagement tracking
    const commentedPostMap = new Map(
      engagementData.commentedPostIds.map((c) => [c.postId, c.latestCommentAt])
    )
    const votedPostMap = new Map(engagementData.votedPostIds.map((v) => [v.postId, v.votedAt]))
    const commentCountMap = new Map(
      engagementData.commentCounts.map((c) => [c.postId, Number(c.count)])
    )

    // Combine all posts into a single engaged posts list
    const allPosts = [...engagementData.authoredPosts, ...engagementData.otherPosts]
    const engagedPostsMap = new Map<string, EngagedPost>()

    for (const post of allPosts) {
      const engagementTypes: EngagementType[] = []
      const engagementDates: Date[] = []

      // Check if authored
      if (engagementData.authoredPosts.some((p) => p.id === post.id)) {
        engagementTypes.push('authored')
        engagementDates.push(post.createdAt)
      }

      // Check if commented
      const commentDate = commentedPostMap.get(post.id)
      if (commentDate) {
        engagementTypes.push('commented')
        engagementDates.push(new Date(commentDate))
      }

      // Check if voted
      const voteDate = votedPostMap.get(post.id)
      if (voteDate) {
        engagementTypes.push('voted')
        engagementDates.push(new Date(voteDate))
      }

      // Only add if there's actual engagement
      if (engagementTypes.length > 0) {
        // Truncate content for preview
        const contentPreview =
          post.content.length > 200 ? post.content.substring(0, 200) + '...' : post.content

        engagedPostsMap.set(post.id, {
          id: post.id,
          title: post.title,
          content: contentPreview,
          statusId: post.statusId,
          statusName: post.statusName,
          statusColor: post.statusColor ?? '#6b7280',
          voteCount: post.voteCount,
          commentCount: commentCountMap.get(post.id) ?? 0,
          boardSlug: post.boardSlug,
          boardName: post.boardName,
          authorName: post.authorName,
          createdAt: post.createdAt,
          engagementTypes,
          engagedAt: new Date(Math.max(...engagementDates.map((d) => d.getTime()))),
        })
      }
    }

    // Sort by most recent engagement
    const engagedPosts = Array.from(engagedPostsMap.values()).sort(
      (a, b) => b.engagedAt.getTime() - a.engagedAt.getTime()
    )

    // Calculate activity counts
    const postCount = engagementData.authoredPosts.length
    const commentCount = engagementData.commentedPostIds.length
    const voteCount = engagementData.votedPostIds.length

    // Fetch segments for this user
    const segmentMap = await fetchSegmentsForPrincipals([principalData.principalId])
    const userSegmentList = segmentMap.get(principalData.principalId) ?? []

    return {
      principalId: principalData.principalId,
      userId: principalData.userId,
      name: principalData.name,
      email: principalData.email,
      image: principalData.image,
      emailVerified: principalData.emailVerified,
      joinedAt: principalData.joinedAt,
      createdAt: principalData.createdAt,
      postCount,
      commentCount,
      voteCount,
      engagedPosts,
      segments: userSegmentList,
    }
  } catch (error) {
    console.error('Error getting portal user detail:', error)
    throw new InternalError('DATABASE_ERROR', 'Failed to get portal user detail', error)
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
