/**
 * Analytics refresh service -- aggregates daily stats and top posts.
 *
 * Called hourly by the analytics BullMQ job. Recomputes today's row in
 * analytics_daily_stats and refreshes the top posts snapshots for all periods.
 */

import {
  db,
  eq,
  gte,
  lte,
  and,
  isNull,
  inArray,
  count,
  ne,
  desc,
  posts,
  votes,
  comments,
  principal,
  postStatuses,
  boards,
  analyticsDailyStats,
  analyticsTopPosts,
} from '@/lib/server/db'

/**
 * Refresh today's row in analytics_daily_stats and the top posts snapshots.
 * Called hourly by the analytics BullMQ job.
 */
export async function refreshAnalytics(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'
  const dayStart = `${today}T00:00:00.000Z`
  const dayEnd = `${today}T23:59:59.999Z`

  console.log(`[analytics] Refreshing stats for ${today}`)

  // Count new posts today (non-deleted)
  const [newPostsResult] = await db
    .select({ value: count() })
    .from(posts)
    .where(
      and(
        gte(posts.createdAt, new Date(dayStart)),
        lte(posts.createdAt, new Date(dayEnd)),
        isNull(posts.deletedAt)
      )
    )

  // Count new votes today
  const [newVotesResult] = await db
    .select({ value: count() })
    .from(votes)
    .where(and(gte(votes.createdAt, new Date(dayStart)), lte(votes.createdAt, new Date(dayEnd))))

  // Count new comments today (non-deleted)
  const [newCommentsResult] = await db
    .select({ value: count() })
    .from(comments)
    .where(
      and(
        gte(comments.createdAt, new Date(dayStart)),
        lte(comments.createdAt, new Date(dayEnd)),
        isNull(comments.deletedAt)
      )
    )

  // Count new non-anonymous users today
  const [newUsersResult] = await db
    .select({ value: count() })
    .from(principal)
    .where(
      and(
        gte(principal.createdAt, new Date(dayStart)),
        lte(principal.createdAt, new Date(dayEnd)),
        ne(principal.type, 'anonymous'),
        eq(principal.role, 'user')
      )
    )

  // Current status distribution (snapshot of all active posts)
  const statusRows = await db
    .select({
      slug: postStatuses.slug,
      value: count(),
    })
    .from(posts)
    .innerJoin(postStatuses, eq(posts.statusId, postStatuses.id))
    .where(isNull(posts.deletedAt))
    .groupBy(postStatuses.slug)

  const postsByStatus: Record<string, number> = {}
  for (const row of statusRows) {
    postsByStatus[row.slug] = row.value
  }

  // Posts by board (new today)
  const boardRows = await db
    .select({
      boardId: posts.boardId,
      value: count(),
    })
    .from(posts)
    .where(
      and(
        gte(posts.createdAt, new Date(dayStart)),
        lte(posts.createdAt, new Date(dayEnd)),
        isNull(posts.deletedAt)
      )
    )
    .groupBy(posts.boardId)

  const postsByBoard: Record<string, number> = {}
  for (const row of boardRows) {
    if (row.boardId) postsByBoard[row.boardId] = row.value
  }

  // Posts by source (new today) -- source is derived from vote sourceType or post metadata
  // For now, default all to 'portal' since source tracking on posts isn't implemented yet
  const postsBySource: Record<string, number> = {
    portal: newPostsResult.value,
  }

  // Upsert today's row
  await db
    .insert(analyticsDailyStats)
    .values({
      date: today,
      newPosts: newPostsResult.value,
      newVotes: newVotesResult.value,
      newComments: newCommentsResult.value,
      newUsers: newUsersResult.value,
      postsByStatus,
      postsByBoard,
      postsBySource,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: analyticsDailyStats.date,
      set: {
        newPosts: newPostsResult.value,
        newVotes: newVotesResult.value,
        newComments: newCommentsResult.value,
        newUsers: newUsersResult.value,
        postsByStatus,
        postsByBoard,
        postsBySource,
        computedAt: new Date(),
      },
    })

  // Refresh top posts for each period
  await refreshTopPosts()

  console.log(`[analytics] Refresh complete for ${today}`)
}

async function refreshTopPosts(): Promise<void> {
  const periods = [
    { key: '7d', days: 7 },
    { key: '30d', days: 30 },
    { key: '90d', days: 90 },
    { key: '12m', days: 365 },
  ] as const

  const now = new Date()

  for (const { key, days } of periods) {
    const since = new Date(now.getTime() - days * 86400000)

    // Get top 10 posts by vote count within the period
    const topPosts = await db
      .select({
        postId: posts.id,
        title: posts.title,
        voteCount: count(votes.id),
        boardName: boards.name,
        statusName: postStatuses.name,
      })
      .from(posts)
      .leftJoin(votes, and(eq(votes.postId, posts.id), gte(votes.createdAt, since)))
      .leftJoin(boards, eq(posts.boardId, boards.id))
      .leftJoin(postStatuses, eq(posts.statusId, postStatuses.id))
      .where(and(isNull(posts.deletedAt), gte(posts.createdAt, since)))
      .groupBy(posts.id, posts.title, boards.name, postStatuses.name)
      .orderBy(desc(count(votes.id)))
      .limit(10)

    // Also get comment counts for these posts
    const postIds = topPosts.map((p) => p.postId)
    const commentCounts: Record<string, number> = {}
    if (postIds.length > 0) {
      const commentRows = await db
        .select({
          postId: comments.postId,
          value: count(),
        })
        .from(comments)
        .where(
          and(
            inArray(comments.postId, postIds),
            gte(comments.createdAt, since),
            isNull(comments.deletedAt)
          )
        )
        .groupBy(comments.postId)

      for (const row of commentRows) {
        commentCounts[row.postId] = row.value
      }
    }

    // Replace entries for this period atomically
    await db.transaction(async (tx) => {
      await tx.delete(analyticsTopPosts).where(eq(analyticsTopPosts.period, key))
      if (topPosts.length > 0) {
        await tx.insert(analyticsTopPosts).values(
          topPosts.map((post, i) => ({
            period: key,
            rank: i + 1,
            postId: post.postId,
            title: post.title,
            voteCount: post.voteCount,
            commentCount: commentCounts[post.postId] ?? 0,
            boardName: post.boardName,
            statusName: post.statusName,
            computedAt: new Date(),
          }))
        )
      }
    })
  }
}
