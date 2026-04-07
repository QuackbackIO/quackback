/**
 * Portal user detail query
 *
 * Fetches a single portal user with their full activity history
 * (posts authored, commented on, and voted on).
 */

import {
  db,
  eq,
  and,
  inArray,
  isNull,
  desc,
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
  asc,
} from '@/lib/server/db'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import { InternalError } from '@/lib/shared/errors'
import { truncate } from '@/lib/shared/utils/string'
import type {
  PortalUserDetail,
  EngagedPost,
  EngagementType,
  UserSegmentSummary,
} from './user.types'

// ---------------------------------------------------------------------------
// Internal helper: batch-fetch segments for a set of principal IDs
// ---------------------------------------------------------------------------

async function fetchSegmentsForUser(
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

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Get detailed information about a portal user including their activity.
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
        metadata: user.metadata,
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
        .where(and(eq(posts.principalId, principalData.principalId), isNull(posts.deletedAt)))
        .orderBy(desc(posts.createdAt))
        .limit(100),

      // Get post IDs the user has commented on (via principalId)
      db
        .select({
          postId: comments.postId,
          latestCommentAt: sql<Date>`max(${comments.createdAt})`.as('latest_comment_at'),
        })
        .from(comments)
        .innerJoin(posts, eq(posts.id, comments.postId))
        .where(and(eq(comments.principalId, principalData.principalId), isNull(posts.deletedAt)))
        .groupBy(comments.postId)
        .limit(100),

      // Get post IDs the user has voted on (via indexed principalId column)
      db
        .select({
          postId: votes.postId,
          votedAt: votes.createdAt,
        })
        .from(votes)
        .innerJoin(posts, eq(posts.id, votes.postId))
        .where(and(eq(votes.principalId, principalData.principalId), isNull(posts.deletedAt)))
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

    // Run all dependent queries in parallel — otherPostCommentCounts uses
    // otherPostIds (available now) instead of waiting for otherPosts results
    const allCommentPostIds = [...authoredPosts.map((p) => p.id), ...otherPostIds]
    const [otherPosts, commentCounts] = await Promise.all([
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
        : [],

      // Get comment counts for all engaged posts in one query
      allCommentPostIds.length > 0
        ? db
            .select({
              postId: comments.postId,
              count: sql<number>`count(*)::int`.as('count'),
            })
            .from(comments)
            .where(and(inArray(comments.postId, allCommentPostIds), isNull(comments.deletedAt)))
            .groupBy(comments.postId)
        : [],
    ])

    const engagementData = {
      authoredPosts,
      commentedPostIds,
      votedPostIds,
      otherPosts,
      commentCounts,
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
    const authoredPostIds = new Set(engagementData.authoredPosts.map((p) => p.id))
    const engagedPostsMap = new Map<string, EngagedPost>()

    for (const post of allPosts) {
      const engagementTypes: EngagementType[] = []
      const engagementDates: Date[] = []

      if (authoredPostIds.has(post.id)) {
        engagementTypes.push('authored')
        engagementDates.push(post.createdAt)
      }

      const commentDate = commentedPostMap.get(post.id)
      if (commentDate) {
        engagementTypes.push('commented')
        engagementDates.push(new Date(commentDate))
      }

      const voteDate = votedPostMap.get(post.id)
      if (voteDate) {
        engagementTypes.push('voted')
        engagementDates.push(new Date(voteDate))
      }

      if (engagementTypes.length > 0) {
        const contentPreview = truncate(post.content, 200)

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

    const postCount = engagementData.authoredPosts.length
    const commentCount = engagementData.commentedPostIds.length
    const voteCount = engagementData.votedPostIds.length

    const segmentMap = await fetchSegmentsForUser([principalData.principalId])
    const userSegmentList = segmentMap.get(principalData.principalId) ?? []

    return {
      principalId: principalData.principalId,
      userId: principalData.userId,
      name: principalData.name,
      email: principalData.email,
      image: principalData.image,
      emailVerified: principalData.emailVerified,
      metadata: principalData.metadata,
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
