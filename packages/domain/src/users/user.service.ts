/**
 * UserService - Business logic for portal user management
 *
 * Provides operations for listing and managing portal users (role='user' in member table).
 * Portal users are authenticated users who can vote/comment on the public portal
 * but don't have admin access (unlike owner/admin/member roles).
 *
 * All users (team + portal) are unified in the member table with roles:
 * - owner/admin/member: Team members with admin dashboard access
 * - user: Portal users with public portal access only
 */

import {
  db,
  withTenantContext,
  eq,
  and,
  or,
  ilike,
  inArray,
  desc,
  asc,
  sql,
  member,
  user,
  posts,
  comments,
  votes,
  boards,
  postStatuses,
  type Database,
} from '@quackback/db'
import type { MemberId, OrgId } from '@quackback/ids'
import { ok, err, type Result } from '../shared/result'
import { UserError } from './user.errors'
import type {
  PortalUserListParams,
  PortalUserListResult,
  PortalUserListItem,
  PortalUserDetail,
  EngagedPost,
  EngagementType,
} from './user.types'

/**
 * Service class for portal user operations
 */
export class UserService {
  /**
   * List portal users for an organization with activity counts
   *
   * Queries member table for role='user'.
   * Activity counts are computed via efficient LEFT JOINs with pre-aggregated subqueries,
   * using the indexed member_id columns on posts, comments, and votes tables.
   */
  async listPortalUsers(
    organizationId: OrgId,
    params: PortalUserListParams = {}
  ): Promise<Result<PortalUserListResult, UserError>> {
    try {
      const { search, verified, dateFrom, dateTo, sort = 'newest', page = 1, limit = 20 } = params

      // Use withTenantContext for RLS-protected tables (posts, comments, votes)
      const { rawUsers, total } = await withTenantContext(organizationId, async (tx: Database) => {
        // Pre-aggregate activity counts in subqueries (executed once, not per-row)
        // These use the indexed member_id columns for efficient lookups
        // Note: We join with boards to satisfy RLS policy (posts are filtered by board's org)
        // Each count column has a unique name to avoid ambiguity in the final SELECT
        const postCounts = tx
          .select({
            memberId: posts.memberId,
            postCount: sql<number>`count(*)::int`.as('post_count'),
          })
          .from(posts)
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .where(eq(boards.organizationId, organizationId))
          .groupBy(posts.memberId)
          .as('post_counts')

        // Comments are linked to posts, which are linked to boards
        const commentCounts = tx
          .select({
            memberId: comments.memberId,
            commentCount: sql<number>`count(*)::int`.as('comment_count'),
          })
          .from(comments)
          .innerJoin(posts, eq(comments.postId, posts.id))
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .where(eq(boards.organizationId, organizationId))
          .groupBy(comments.memberId)
          .as('comment_counts')

        // Votes are linked to posts, which are linked to boards
        // Use votes.member_id (indexed) instead of string concatenation on user_identifier
        const voteCounts = tx
          .select({
            memberId: votes.memberId,
            voteCount: sql<number>`count(*)::int`.as('vote_count'),
          })
          .from(votes)
          .innerJoin(posts, eq(votes.postId, posts.id))
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .where(eq(boards.organizationId, organizationId))
          .groupBy(votes.memberId)
          .as('vote_counts')

        // Build conditions array - filter for role='user' (portal users only)
        const conditions = [eq(member.organizationId, organizationId), eq(member.role, 'user')]

        // Search filter (name or email)
        if (search) {
          conditions.push(or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))!)
        }

        // Verified filter
        if (verified !== undefined) {
          conditions.push(eq(user.emailVerified, verified))
        }

        // Date range filters (on member.createdAt = join date)
        if (dateFrom) {
          conditions.push(sql`${member.createdAt} >= ${dateFrom}`)
        }
        if (dateTo) {
          conditions.push(sql`${member.createdAt} <= ${dateTo}`)
        }

        const whereClause = and(...conditions)

        // Build sort order - now references the joined count columns
        let orderBy
        switch (sort) {
          case 'oldest':
            orderBy = asc(member.createdAt)
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
            orderBy = desc(member.createdAt)
        }

        // Main query with LEFT JOINs to pre-aggregated counts
        const [usersResult, countResult] = await Promise.all([
          tx
            .select({
              memberId: member.id,
              userId: user.id,
              name: user.name,
              email: user.email,
              image: user.image,
              emailVerified: user.emailVerified,
              joinedAt: member.createdAt,
              postCount: sql<number>`COALESCE(${postCounts.postCount}, 0)`,
              commentCount: sql<number>`COALESCE(${commentCounts.commentCount}, 0)`,
              voteCount: sql<number>`COALESCE(${voteCounts.voteCount}, 0)`,
            })
            .from(member)
            .innerJoin(user, eq(member.userId, user.id))
            .leftJoin(postCounts, eq(postCounts.memberId, member.id))
            .leftJoin(commentCounts, eq(commentCounts.memberId, member.id))
            .leftJoin(voteCounts, eq(voteCounts.memberId, member.id))
            .where(whereClause)
            .orderBy(orderBy)
            .limit(limit)
            .offset((page - 1) * limit),
          tx
            .select({ count: sql<number>`count(*)::int` })
            .from(member)
            .innerJoin(user, eq(member.userId, user.id))
            .where(whereClause),
        ])

        return {
          rawUsers: usersResult,
          total: Number(countResult[0]?.count ?? 0),
        }
      })

      const items: PortalUserListItem[] = rawUsers.map((row) => ({
        memberId: row.memberId,
        userId: row.userId,
        name: row.name,
        email: row.email,
        image: row.image,
        emailVerified: row.emailVerified,
        joinedAt: row.joinedAt,
        postCount: Number(row.postCount),
        commentCount: Number(row.commentCount),
        voteCount: Number(row.voteCount),
      }))

      return ok({
        items,
        total,
        hasMore: page * limit < total,
      })
    } catch (error) {
      console.error('Error listing portal users:', error)
      return err(UserError.databaseError('Failed to list portal users'))
    }
  }

  /**
   * Get detailed information about a portal user including their activity
   *
   * Returns user info and all posts they've engaged with (authored, commented on, or voted on).
   */
  async getPortalUserDetail(
    memberId: MemberId,
    organizationId: OrgId
  ): Promise<Result<PortalUserDetail | null, UserError>> {
    try {
      // Get member with user details (filter for role='user')
      const memberResult = await db
        .select({
          memberId: member.id,
          userId: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          emailVerified: user.emailVerified,
          joinedAt: member.createdAt,
          createdAt: user.createdAt,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.id, memberId),
            eq(member.organizationId, organizationId),
            eq(member.role, 'user')
          )
        )
        .limit(1)

      if (memberResult.length === 0) {
        return ok(null)
      }

      const memberData = memberResult[0]
      // memberData.memberId is already in MemberId format from the query
      const memberIdForQuery = memberData.memberId

      // Use withTenantContext for RLS-protected queries (posts, comments, votes)
      const engagementData = await withTenantContext(organizationId, async (tx: Database) => {
        // Run independent queries in parallel for better performance
        const [authoredPosts, commentedPostIds, votedPostIds] = await Promise.all([
          // Get posts authored by this user (via memberId)
          tx
            .select({
              id: posts.id,
              title: posts.title,
              content: posts.content,
              statusId: posts.statusId,
              voteCount: posts.voteCount,
              createdAt: posts.createdAt,
              authorName: posts.authorName,
              boardSlug: boards.slug,
              boardName: boards.name,
              statusName: postStatuses.name,
              statusColor: postStatuses.color,
            })
            .from(posts)
            .innerJoin(boards, eq(posts.boardId, boards.id))
            .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
            .where(eq(posts.memberId, memberIdForQuery))
            .orderBy(desc(posts.createdAt))
            .limit(100),

          // Get post IDs the user has commented on (via memberId)
          tx
            .select({
              postId: comments.postId,
              latestCommentAt: sql<Date>`max(${comments.createdAt})`.as('latest_comment_at'),
            })
            .from(comments)
            .where(eq(comments.memberId, memberIdForQuery))
            .groupBy(comments.postId)
            .limit(100),

          // Get post IDs the user has voted on (via indexed memberId column)
          tx
            .select({
              postId: votes.postId,
              votedAt: votes.createdAt,
            })
            .from(votes)
            .where(eq(votes.memberId, memberIdForQuery))
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
            ? tx
                .select({
                  id: posts.id,
                  title: posts.title,
                  content: posts.content,
                  statusId: posts.statusId,
                  voteCount: posts.voteCount,
                  createdAt: posts.createdAt,
                  authorName: posts.authorName,
                  boardSlug: boards.slug,
                  boardName: boards.name,
                  statusName: postStatuses.name,
                  statusColor: postStatuses.color,
                })
                .from(posts)
                .innerJoin(boards, eq(posts.boardId, boards.id))
                .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
                .where(inArray(posts.id, otherPostIds))
            : Promise.resolve([]),

          // Get comment counts for authored posts (we'll add otherPosts counts after)
          authoredPosts.length > 0
            ? tx
                .select({
                  postId: comments.postId,
                  count: sql<number>`count(*)::int`.as('count'),
                })
                .from(comments)
                .where(
                  inArray(
                    comments.postId,
                    authoredPosts.map((p) => p.id)
                  )
                )
                .groupBy(comments.postId)
            : Promise.resolve([]),
        ])

        // Get comment counts for other posts if we have any
        const otherPostCommentCounts =
          otherPosts.length > 0
            ? await tx
                .select({
                  postId: comments.postId,
                  count: sql<number>`count(*)::int`.as('count'),
                })
                .from(comments)
                .where(
                  inArray(
                    comments.postId,
                    otherPosts.map((p) => p.id)
                  )
                )
                .groupBy(comments.postId)
            : []

        return {
          authoredPosts,
          commentedPostIds,
          votedPostIds,
          otherPosts,
          commentCounts: [...commentCounts, ...otherPostCommentCounts],
        }
      })

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

      return ok({
        memberId: memberData.memberId,
        userId: memberData.userId,
        name: memberData.name,
        email: memberData.email,
        image: memberData.image,
        emailVerified: memberData.emailVerified,
        joinedAt: memberData.joinedAt,
        createdAt: memberData.createdAt,
        postCount,
        commentCount,
        voteCount,
        engagedPosts,
      })
    } catch (error) {
      console.error('Error getting portal user detail:', error)
      return err(UserError.databaseError('Failed to get portal user detail'))
    }
  }

  /**
   * Remove a portal user from an organization
   *
   * Deletes the member record with role='user'.
   * Since users are org-scoped, this also deletes the user record (CASCADE).
   */
  async removePortalUser(
    memberId: MemberId,
    organizationId: OrgId
  ): Promise<Result<void, UserError>> {
    try {
      // Verify member exists, belongs to this org, and has role='user'
      const existingMember = await db.query.member.findFirst({
        where: and(
          eq(member.id, memberId),
          eq(member.organizationId, organizationId),
          eq(member.role, 'user')
        ),
      })

      if (!existingMember) {
        return err(UserError.memberNotFound(memberId))
      }

      // Delete member record (user record will be deleted via CASCADE since user is org-scoped)
      await db.delete(member).where(eq(member.id, memberId))

      return ok(undefined)
    } catch (error) {
      console.error('Error removing portal user:', error)
      return err(UserError.databaseError('Failed to remove portal user'))
    }
  }
}

// Singleton instance
export const userService = new UserService()
