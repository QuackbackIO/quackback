/**
 * UserService - Business logic for portal user management
 *
 * Provides operations for listing and managing portal users (members with role='user').
 * This service handles user listing, detail retrieval, role changes, and removal.
 */

import {
  db,
  withUnitOfWork,
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
  type UnitOfWork,
  type Database,
} from '@quackback/db'
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
   * Only returns members with role='user' (portal users).
   * Includes post count, comment count, and vote count for each user.
   */
  async listPortalUsers(
    organizationId: string,
    params: PortalUserListParams = {}
  ): Promise<Result<PortalUserListResult, UserError>> {
    try {
      const { search, verified, dateFrom, dateTo, sort = 'newest', page = 1, limit = 20 } = params

      // Build conditions array
      const conditions = [
        eq(member.organizationId, organizationId),
        eq(member.role, 'user'), // Only portal users
      ]

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

      // Activity count subqueries - these query RLS-protected tables
      const postCountSql = sql<number>`(
        SELECT COALESCE(count(*)::int, 0) FROM posts
        WHERE member_id = ${member.id}
      )`.as('post_count')

      const commentCountSql = sql<number>`(
        SELECT COALESCE(count(*)::int, 0) FROM comments
        WHERE member_id = ${member.id}
      )`.as('comment_count')

      const voteCountSql = sql<number>`(
        SELECT COALESCE(count(*)::int, 0) FROM votes
        WHERE user_identifier = 'member:' || ${member.id}
      )`.as('vote_count')

      // Build sort order
      let orderBy
      switch (sort) {
        case 'oldest':
          orderBy = asc(member.createdAt)
          break
        case 'most_active':
          // Sort by total activity (posts + comments + votes)
          orderBy = desc(
            sql`(
              SELECT COALESCE(count(*)::int, 0) FROM posts WHERE member_id = ${member.id}
            ) + (
              SELECT COALESCE(count(*)::int, 0) FROM comments WHERE member_id = ${member.id}
            ) + (
              SELECT COALESCE(count(*)::int, 0) FROM votes WHERE user_identifier = 'member:' || ${member.id}
            )`
          )
          break
        case 'name':
          orderBy = asc(user.name)
          break
        case 'newest':
        default:
          orderBy = desc(member.createdAt)
      }

      // Use withTenantContext because subqueries access RLS-protected tables (posts, comments, votes)
      const { rawUsers, total } = await withTenantContext(organizationId, async (tx: Database) => {
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
              role: member.role,
              postCount: postCountSql,
              commentCount: commentCountSql,
              voteCount: voteCountSql,
            })
            .from(member)
            .innerJoin(user, eq(member.userId, user.id))
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
        role: row.role,
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
    memberId: string,
    organizationId: string
  ): Promise<Result<PortalUserDetail | null, UserError>> {
    try {
      // Get member with user details (no RLS needed for member/user tables)
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
          role: member.role,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
        .limit(1)

      if (memberResult.length === 0) {
        return ok(null)
      }

      const memberData = memberResult[0]
      const userIdentifier = `member:${memberId}`

      // Use withTenantContext for RLS-protected queries (posts, comments, votes)
      const engagementData = await withTenantContext(organizationId, async (tx: Database) => {
        // Get posts authored by this user
        const authoredPosts = await tx
          .select({
            id: posts.id,
            title: posts.title,
            content: posts.content,
            status: posts.status,
            voteCount: posts.voteCount,
            createdAt: posts.createdAt,
            authorName: posts.authorName,
            boardSlug: boards.slug,
            boardName: boards.name,
            statusColor: postStatuses.color,
          })
          .from(posts)
          .innerJoin(boards, eq(posts.boardId, boards.id))
          .leftJoin(
            postStatuses,
            and(
              eq(postStatuses.slug, posts.status),
              eq(postStatuses.organizationId, organizationId)
            )
          )
          .where(eq(posts.memberId, memberId))
          .orderBy(desc(posts.createdAt))
          .limit(100)

        // Get post IDs the user has commented on (excluding their own posts)
        const commentedPostIds = await tx
          .select({
            postId: comments.postId,
            latestCommentAt: sql<Date>`max(${comments.createdAt})`.as('latest_comment_at'),
          })
          .from(comments)
          .where(eq(comments.memberId, memberId))
          .groupBy(comments.postId)
          .limit(100)

        // Get post IDs the user has voted on
        const votedPostIds = await tx
          .select({
            postId: votes.postId,
            votedAt: votes.createdAt,
          })
          .from(votes)
          .where(eq(votes.userIdentifier, userIdentifier))
          .orderBy(desc(votes.createdAt))
          .limit(100)

        // Collect all unique post IDs that aren't authored by user (for fetching additional posts)
        const authoredIds = new Set(authoredPosts.map((p) => p.id))
        const otherPostIds = [
          ...new Set([
            ...commentedPostIds.map((c) => c.postId).filter((id) => !authoredIds.has(id)),
            ...votedPostIds.map((v) => v.postId).filter((id) => !authoredIds.has(id)),
          ]),
        ]

        // Fetch posts the user engaged with but didn't author
        const otherPosts =
          otherPostIds.length > 0
            ? await tx
                .select({
                  id: posts.id,
                  title: posts.title,
                  content: posts.content,
                  status: posts.status,
                  voteCount: posts.voteCount,
                  createdAt: posts.createdAt,
                  authorName: posts.authorName,
                  boardSlug: boards.slug,
                  boardName: boards.name,
                  statusColor: postStatuses.color,
                })
                .from(posts)
                .innerJoin(boards, eq(posts.boardId, boards.id))
                .leftJoin(
                  postStatuses,
                  and(
                    eq(postStatuses.slug, posts.status),
                    eq(postStatuses.organizationId, organizationId)
                  )
                )
                .where(inArray(posts.id, otherPostIds))
            : []

        // Get comment counts for all relevant posts
        const allPostIds = [...authoredPosts.map((p) => p.id), ...otherPosts.map((p) => p.id)]
        const commentCounts =
          allPostIds.length > 0
            ? await tx
                .select({
                  postId: comments.postId,
                  count: sql<number>`count(*)::int`.as('count'),
                })
                .from(comments)
                .where(inArray(comments.postId, allPostIds))
                .groupBy(comments.postId)
            : []

        return {
          authoredPosts,
          commentedPostIds,
          votedPostIds,
          otherPosts,
          commentCounts,
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
            status: post.status,
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
        role: memberData.role,
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
   * Update a member's role
   *
   * Only owners and admins can change roles.
   * Cannot change your own role.
   * Cannot change owner's role (unless you are the owner transferring ownership).
   */
  async updateMemberRole(
    memberId: string,
    newRole: string,
    organizationId: string,
    actorMemberId: string
  ): Promise<Result<{ memberId: string; role: string }, UserError>> {
    return withUnitOfWork(organizationId, async (uow: UnitOfWork) => {
      // Validate role
      const validRoles = ['user', 'member', 'admin', 'owner']
      if (!validRoles.includes(newRole)) {
        return err(UserError.invalidRole(newRole))
      }

      // Get target member
      const targetMember = await uow.db.query.member.findFirst({
        where: and(eq(member.id, memberId), eq(member.organizationId, organizationId)),
      })

      if (!targetMember) {
        return err(UserError.memberNotFound(memberId))
      }

      // Cannot change your own role
      if (memberId === actorMemberId) {
        return err(UserError.cannotChangeOwnRole())
      }

      // Get actor's role to check permissions
      const actorMember = await uow.db.query.member.findFirst({
        where: and(eq(member.id, actorMemberId), eq(member.organizationId, organizationId)),
      })

      if (!actorMember || !['owner', 'admin'].includes(actorMember.role)) {
        return err(UserError.unauthorized('change member roles'))
      }

      // Only owner can promote to owner or change another owner's role
      if ((newRole === 'owner' || targetMember.role === 'owner') && actorMember.role !== 'owner') {
        return err(UserError.unauthorized('change owner roles'))
      }

      // Update role
      await uow.db.update(member).set({ role: newRole }).where(eq(member.id, memberId))

      return ok({ memberId, role: newRole })
    })
  }

  /**
   * Remove a member from an organization
   *
   * Only owners and admins can remove members.
   * Cannot remove the owner.
   * Cannot remove yourself.
   */
  async removeMember(
    memberId: string,
    organizationId: string,
    actorMemberId: string
  ): Promise<Result<void, UserError>> {
    return withUnitOfWork(organizationId, async (uow: UnitOfWork) => {
      // Get target member
      const targetMember = await uow.db.query.member.findFirst({
        where: and(eq(member.id, memberId), eq(member.organizationId, organizationId)),
      })

      if (!targetMember) {
        return err(UserError.memberNotFound(memberId))
      }

      // Cannot remove owner
      if (targetMember.role === 'owner') {
        return err(UserError.cannotRemoveOwner())
      }

      // Cannot remove yourself
      if (memberId === actorMemberId) {
        return err(UserError.unauthorized('remove yourself'))
      }

      // Get actor's role to check permissions
      const actorMember = await uow.db.query.member.findFirst({
        where: and(eq(member.id, actorMemberId), eq(member.organizationId, organizationId)),
      })

      if (!actorMember || !['owner', 'admin'].includes(actorMember.role)) {
        return err(UserError.unauthorized('remove members'))
      }

      // Delete member record (cascades to delete user since user is org-scoped)
      await uow.db.delete(member).where(eq(member.id, memberId))

      return ok(undefined)
    })
  }
}

// Singleton instance
export const userService = new UserService()
