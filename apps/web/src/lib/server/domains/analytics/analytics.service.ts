/**
 * Analytics service for the admin briefing page.
 *
 * Provides aggregated metrics: trending posts, unresponded items,
 * stale planned posts, negative hotspots, activity counts,
 * status pipeline, and response health.
 */

import {
  db,
  posts,
  votes,
  comments,
  postSentiment,
  postStatuses,
  boards,
  eq,
  and,
  gte,
  lte,
  lt,
  isNull,
  sql,
  count,
  desc,
  asc,
} from '@/lib/server/db'

/** Standard filters for visible, non-merged posts. */
function visiblePosts() {
  return and(
    isNull(posts.deletedAt),
    eq(posts.moderationState, 'published'),
    isNull(posts.canonicalPostId)
  )
}

// ---------------------------------------------------------------------------
// Trending Posts
// ---------------------------------------------------------------------------

export async function getTrendingPosts(start: Date, end: Date, limit = 5) {
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      boardName: boards.name,
      sentiment: postSentiment.sentiment,
      statusName: postStatuses.name,
      statusColor: postStatuses.color,
      votesInPeriod: count(votes.id),
    })
    .from(posts)
    .innerJoin(
      votes,
      and(eq(votes.postId, posts.id), gte(votes.createdAt, start), lte(votes.createdAt, end))
    )
    .leftJoin(postSentiment, eq(postSentiment.postId, posts.id))
    .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(visiblePosts())
    .groupBy(
      posts.id,
      posts.title,
      posts.voteCount,
      boards.name,
      postSentiment.sentiment,
      postStatuses.name,
      postStatuses.color
    )
    .orderBy(desc(count(votes.id)))
    .limit(limit)

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    voteCount: r.voteCount,
    boardName: r.boardName,
    sentiment: r.sentiment as 'positive' | 'neutral' | 'negative' | null,
    statusName: r.statusName as string | null,
    statusColor: r.statusColor as string | null,
    votesInPeriod: Number(r.votesInPeriod),
  }))
}

// ---------------------------------------------------------------------------
// Unresponded Posts
// ---------------------------------------------------------------------------

export async function getUnrespondedPosts(limit = 3) {
  const where = and(isNull(posts.officialResponseAt), visiblePosts())

  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      createdAt: posts.createdAt,
      boardName: boards.name,
      totalCount: sql<number>`COUNT(*) OVER()`,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(where)
    .orderBy(asc(posts.createdAt))
    .limit(limit)

  return {
    totalCount: Number(rows[0]?.totalCount ?? 0),
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      voteCount: r.voteCount,
      createdAt: r.createdAt,
      boardName: r.boardName,
    })),
  }
}

// ---------------------------------------------------------------------------
// Stale Planned Posts
// ---------------------------------------------------------------------------

export async function getStalePlannedPosts(staleDays = 30, limit = 3) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - staleDays)

  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      statusName: postStatuses.name,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .innerJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .where(
      and(
        eq(postStatuses.category, 'active'),
        eq(postStatuses.isDefault, false),
        lt(posts.updatedAt, cutoff),
        isNull(posts.deletedAt),
        isNull(posts.canonicalPostId)
      )
    )
    .orderBy(asc(posts.updatedAt))
    .limit(limit)

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    statusName: r.statusName,
    updatedAt: r.updatedAt,
  }))
}

// ---------------------------------------------------------------------------
// Negative Hotspots
// ---------------------------------------------------------------------------

export async function getNegativeHotspots(minVotes = 10, limit = 3) {
  const where = and(
    eq(postSentiment.sentiment, 'negative'),
    gte(posts.voteCount, minVotes),
    isNull(posts.deletedAt),
    isNull(posts.canonicalPostId)
  )

  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      statusName: postStatuses.name,
      statusColor: postStatuses.color,
      totalCount: sql<number>`COUNT(*) OVER()`,
    })
    .from(posts)
    .innerJoin(postSentiment, eq(postSentiment.postId, posts.id))
    .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .where(where)
    .orderBy(desc(posts.voteCount))
    .limit(limit)

  return {
    totalCount: Number(rows[0]?.totalCount ?? 0),
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      voteCount: r.voteCount,
      statusName: r.statusName as string | null,
      statusColor: r.statusColor as string | null,
    })),
  }
}

// ---------------------------------------------------------------------------
// Activity Counts
// ---------------------------------------------------------------------------

/** Counts all posts/votes/comments in a period (includes all moderation states for raw activity). */
export async function getActivityCounts(start: Date, end: Date) {
  const [postResult, voteResult, commentResult] = await Promise.all([
    db
      .select({ count: count() })
      .from(posts)
      .where(and(gte(posts.createdAt, start), lte(posts.createdAt, end), isNull(posts.deletedAt))),
    db
      .select({ count: count() })
      .from(votes)
      .where(and(gte(votes.createdAt, start), lte(votes.createdAt, end))),
    db
      .select({ count: count() })
      .from(comments)
      .where(
        and(
          gte(comments.createdAt, start),
          lte(comments.createdAt, end),
          isNull(comments.deletedAt)
        )
      ),
  ])

  return {
    posts: Number(postResult[0]?.count ?? 0),
    votes: Number(voteResult[0]?.count ?? 0),
    comments: Number(commentResult[0]?.count ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Activity Time Series (for sparklines)
// ---------------------------------------------------------------------------

/** Per-day counts of posts, votes, and comments over a date range. */
export async function getActivityTimeSeries(start: Date, end: Date) {
  const [postRows, voteRows, commentRows] = await Promise.all([
    db
      .select({
        day: sql<string>`${posts.createdAt}::date::text`,
        count: count(),
      })
      .from(posts)
      .where(and(gte(posts.createdAt, start), lte(posts.createdAt, end), isNull(posts.deletedAt)))
      .groupBy(sql`${posts.createdAt}::date`)
      .orderBy(sql`${posts.createdAt}::date`),
    db
      .select({
        day: sql<string>`${votes.createdAt}::date::text`,
        count: count(),
      })
      .from(votes)
      .where(and(gte(votes.createdAt, start), lte(votes.createdAt, end)))
      .groupBy(sql`${votes.createdAt}::date`)
      .orderBy(sql`${votes.createdAt}::date`),
    db
      .select({
        day: sql<string>`${comments.createdAt}::date::text`,
        count: count(),
      })
      .from(comments)
      .where(
        and(
          gte(comments.createdAt, start),
          lte(comments.createdAt, end),
          isNull(comments.deletedAt)
        )
      )
      .groupBy(sql`${comments.createdAt}::date`)
      .orderBy(sql`${comments.createdAt}::date`),
  ])

  const postMap = new Map(postRows.map((r) => [r.day, Number(r.count)]))
  const voteMap = new Map(voteRows.map((r) => [r.day, Number(r.count)]))
  const commentMap = new Map(commentRows.map((r) => [r.day, Number(r.count)]))

  // Fill in every day in the range so sparklines show zeros instead of gaps
  const postCounts: number[] = []
  const voteCounts: number[] = []
  const commentCounts: number[] = []
  const d = new Date(start)
  while (d <= end) {
    const key = d.toISOString().slice(0, 10)
    postCounts.push(postMap.get(key) ?? 0)
    voteCounts.push(voteMap.get(key) ?? 0)
    commentCounts.push(commentMap.get(key) ?? 0)
    d.setDate(d.getDate() + 1)
  }

  return { posts: postCounts, votes: voteCounts, comments: commentCounts }
}

// ---------------------------------------------------------------------------
// Status Pipeline
// ---------------------------------------------------------------------------

export async function getStatusPipeline() {
  const rows = await db
    .select({
      name: postStatuses.name,
      slug: postStatuses.slug,
      color: postStatuses.color,
      category: postStatuses.category,
      isDefault: postStatuses.isDefault,
      count: count(posts.id),
    })
    .from(postStatuses)
    .leftJoin(
      posts,
      and(
        eq(posts.statusId, postStatuses.id),
        isNull(posts.deletedAt),
        eq(posts.moderationState, 'published')
      )
    )
    .where(isNull(postStatuses.deletedAt))
    .groupBy(
      postStatuses.id,
      postStatuses.name,
      postStatuses.slug,
      postStatuses.color,
      postStatuses.category,
      postStatuses.isDefault,
      postStatuses.position
    )
    .orderBy(asc(postStatuses.position))

  return rows.map((r) => ({
    label: r.name,
    slug: r.slug,
    color: r.color,
    category: r.category,
    count: Number(r.count),
  }))
}

// ---------------------------------------------------------------------------
// Response Health
// ---------------------------------------------------------------------------

export async function getResponseHealth(start: Date, end: Date) {
  const result = await db
    .select({
      total: count(),
      respondedWithin48h: count(
        sql`CASE WHEN ${posts.officialResponseAt} IS NOT NULL
            AND ${posts.officialResponseAt} - ${posts.createdAt} <= INTERVAL '48 hours'
            THEN 1 END`
      ),
      avgHours: sql<number | null>`AVG(CASE WHEN ${posts.officialResponseAt} IS NOT NULL
          THEN EXTRACT(EPOCH FROM (${posts.officialResponseAt} - ${posts.createdAt})) / 3600 END)`,
    })
    .from(posts)
    .where(and(gte(posts.createdAt, start), lte(posts.createdAt, end), visiblePosts()))

  const row = result[0]
  return {
    respondedWithin48h: Number(row?.respondedWithin48h ?? 0),
    totalInPeriod: Number(row?.total ?? 0),
    avgResponseHours: row?.avgHours ? Number(row.avgHours) : null,
  }
}
