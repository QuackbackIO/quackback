/**
 * Analytics server functions.
 *
 * Reads from the materialized analytics tables and returns
 * all data needed for the analytics dashboard.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  db,
  sql,
  eq,
  and,
  gte,
  isNull,
  isNotNull,
  sum,
  desc,
  analyticsDailyStats,
  analyticsTopPosts,
  postStatuses,
  postSubscriptions,
  changelogEntries,
  conversations,
  boards,
} from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { summarizeCsat } from '@/lib/server/domains/analytics/csat-summary'
import { computeResolutionRate } from '@/lib/server/domains/analytics/resolution'
import { toIsoDateOnly } from '@/lib/shared/utils/date'

export const getAnalyticsData = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ period: z.enum(['7d', '30d', '90d', '12m']) }))
  .handler(async ({ data: { period } }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    // -- Date ranges --
    const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365
    const now = new Date()
    const start = new Date(now.getTime() - days * 86_400_000)
    const previousStart = new Date(start.getTime() - days * 86_400_000)

    const startStr = toIsoDateOnly(start)
    const previousStartStr = toIsoDateOnly(previousStart)

    // -- Fetch daily stats for current and previous periods --
    const allRows = await db
      .select()
      .from(analyticsDailyStats)
      .where(gte(analyticsDailyStats.date, previousStartStr))
      .orderBy(analyticsDailyStats.date)

    const currentRows = allRows.filter((r) => r.date >= startStr)
    const previousRows = allRows.filter((r) => r.date >= previousStartStr && r.date < startStr)

    // -- Summary totals --
    const sumField = (
      rows: typeof allRows,
      field: 'newPosts' | 'newVotes' | 'newComments' | 'newUsers'
    ) => rows.reduce((acc, r) => acc + r[field], 0)

    const currentPosts = sumField(currentRows, 'newPosts')
    const currentVotes = sumField(currentRows, 'newVotes')
    const currentComments = sumField(currentRows, 'newComments')
    const currentUsers = sumField(currentRows, 'newUsers')

    const prevPosts = sumField(previousRows, 'newPosts')
    const prevVotes = sumField(previousRows, 'newVotes')
    const prevComments = sumField(previousRows, 'newComments')
    const prevUsers = sumField(previousRows, 'newUsers')

    const delta = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0
      return Math.round(((current - previous) / previous) * 100)
    }

    const summary = {
      posts: { total: currentPosts, delta: delta(currentPosts, prevPosts) },
      votes: { total: currentVotes, delta: delta(currentVotes, prevVotes) },
      comments: { total: currentComments, delta: delta(currentComments, prevComments) },
      users: { total: currentUsers, delta: delta(currentUsers, prevUsers) },
    }

    // -- Daily stats for chart --
    const dailyStats = currentRows.map((r) => ({
      date: r.date,
      posts: r.newPosts,
      votes: r.newVotes,
      comments: r.newComments,
      users: r.newUsers,
    }))

    // -- Status distribution from latest day's snapshot --
    const statusColors = await db
      .select({
        slug: postStatuses.slug,
        name: postStatuses.name,
        color: postStatuses.color,
        category: postStatuses.category,
      })
      .from(postStatuses)

    const statusMap = new Map(statusColors.map((s) => [s.slug, { name: s.name, color: s.color }]))

    const latestRow = currentRows.length > 0 ? currentRows[currentRows.length - 1] : null
    const statusDistribution: Array<{ status: string; color: string; count: number }> = []
    if (latestRow?.postsByStatus) {
      for (const [slug, count] of Object.entries(latestRow.postsByStatus)) {
        const info = statusMap.get(slug)
        statusDistribution.push({
          status: info?.name ?? slug,
          color: info?.color ?? '#94a3b8',
          count,
        })
      }
    }

    // Resolution = current posts in a terminal status (complete/closed) — a
    // snapshot of backlog health, derived from the same status snapshot.
    const categoryBySlug = new Map(statusColors.map((s) => [s.slug, s.category]))
    const { resolutionRate } = computeResolutionRate(latestRow?.postsByStatus ?? {}, categoryBySlug)

    // -- Board breakdown: sum postsByBoard across date range --
    const boardTotals = new Map<string, number>()
    for (const row of currentRows) {
      if (row.postsByBoard) {
        for (const [boardId, cnt] of Object.entries(row.postsByBoard)) {
          boardTotals.set(boardId, (boardTotals.get(boardId) ?? 0) + cnt)
        }
      }
    }

    // Resolve board names
    const allBoards = await db.select({ id: boards.id, name: boards.name }).from(boards)
    const boardNameMap = new Map(allBoards.map((b) => [b.id, b.name]))

    const boardBreakdown = Array.from(boardTotals.entries())
      .map(([boardId, count]) => ({
        board: boardNameMap.get(boardId as never) ?? boardId,
        count,
      }))
      .sort((a, b) => b.count - a.count)

    // -- Followers: how many people subscribe to (watch) posts. A demand signal:
    // one row per principal per post. Current total, not period-scoped. --
    const [{ followers } = { followers: 0 }] = await db
      .select({ followers: sql<number>`count(*)::int` })
      .from(postSubscriptions)

    // -- Top posts --
    const topPostRows = await db
      .select()
      .from(analyticsTopPosts)
      .where(eq(analyticsTopPosts.period, period))
      .orderBy(analyticsTopPosts.rank)

    const topPosts = topPostRows.map((r) => ({
      rank: r.rank,
      postId: r.postId,
      title: r.title,
      voteCount: r.voteCount,
      commentCount: r.commentCount,
      boardName: r.boardName,
      statusName: r.statusName,
    }))

    // -- Top 5 contributors + period-wide totals (one pass) --
    // Use ISO string to ensure PostgreSQL receives a valid timestamptz literal.
    // The window aggregates run over every contributor that passes WHERE (before
    // ORDER BY/LIMIT), so each of the top-5 rows also carries the full
    // contributor count and total activity — no second scan needed.
    const sinceIso = start.toISOString()
    const contributorRows = await db.execute(sql`
      SELECT
        p.id as "principalId",
        p.display_name as "displayName",
        p.avatar_url as "avatarUrl",
        COALESCE(post_counts.cnt, 0)::int as posts,
        COALESCE(vote_counts.cnt, 0)::int as votes,
        COALESCE(comment_counts.cnt, 0)::int as comments,
        (COALESCE(post_counts.cnt, 0) + COALESCE(vote_counts.cnt, 0) + COALESCE(comment_counts.cnt, 0))::int as total,
        (COUNT(*) OVER ())::int as "contributorCount",
        (SUM(COALESCE(post_counts.cnt, 0) + COALESCE(vote_counts.cnt, 0) + COALESCE(comment_counts.cnt, 0)) OVER ())::int as "totalActivity"
      FROM principal p
      LEFT JOIN (
        SELECT principal_id as pid, COUNT(*)::int as cnt
        FROM posts WHERE created_at >= ${sinceIso}::timestamptz AND deleted_at IS NULL
        GROUP BY principal_id
      ) post_counts ON post_counts.pid = p.id
      LEFT JOIN (
        SELECT principal_id as pid, COUNT(*)::int as cnt
        FROM votes WHERE created_at >= ${sinceIso}::timestamptz
        GROUP BY principal_id
      ) vote_counts ON vote_counts.pid = p.id
      LEFT JOIN (
        SELECT principal_id as pid, COUNT(*)::int as cnt
        FROM comments WHERE created_at >= ${sinceIso}::timestamptz AND deleted_at IS NULL
        GROUP BY principal_id
      ) comment_counts ON comment_counts.pid = p.id
      WHERE p.type != 'anonymous' AND p.role = 'user'
        AND (COALESCE(post_counts.cnt, 0) + COALESCE(vote_counts.cnt, 0) + COALESCE(comment_counts.cnt, 0)) > 0
      ORDER BY total DESC
      LIMIT 5
    `)

    const rawContributors = contributorRows as unknown as Array<{
      principalId: string
      displayName: string | null
      avatarUrl: string | null
      posts: number
      votes: number
      comments: number
      total: number
      contributorCount: number
      totalActivity: number
    }>

    const topContributors = rawContributors.map((r) => ({
      principalId: r.principalId,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      posts: r.posts,
      votes: r.votes,
      comments: r.comments,
      total: r.total,
    }))

    // The window aggregates are identical on every row; read them off the first
    // (0 contributors → no rows → fall back to 0).
    const contributorCount = rawContributors[0]?.contributorCount ?? 0
    const totalActivity = rawContributors[0]?.totalActivity ?? 0

    // -- Changelog stats (single transaction to keep totalViews consistent with topEntries) --
    const [changelogResult, topChangelogEntries] = await db.transaction(async (tx) => {
      const totals = await tx
        .select({
          totalViews: sum(changelogEntries.viewCount),
          // All-time published entries (drafts excluded) — the denominator for
          // "avg views / entry".
          publishedCount: sql<number>`count(*) FILTER (WHERE ${changelogEntries.publishedAt} IS NOT NULL AND ${changelogEntries.publishedAt} <= ${now.toISOString()}::timestamptz)::int`,
          // Entries published within the selected period — responds to the
          // period selector.
          publishedInPeriod: sql<number>`count(*) FILTER (WHERE ${changelogEntries.publishedAt} >= ${start.toISOString()}::timestamptz AND ${changelogEntries.publishedAt} <= ${now.toISOString()}::timestamptz)::int`,
        })
        .from(changelogEntries)
        .where(isNull(changelogEntries.deletedAt))
      const top = await tx
        .select({
          id: changelogEntries.id,
          title: changelogEntries.title,
          viewCount: changelogEntries.viewCount,
        })
        .from(changelogEntries)
        .where(isNull(changelogEntries.deletedAt))
        .orderBy(desc(changelogEntries.viewCount))
        .limit(5)
      return [totals, top] as const
    })

    const totalViews = Number(changelogResult[0]?.totalViews ?? 0)
    const changelogPublishedCount = Number(changelogResult[0]?.publishedCount ?? 0)
    const changelogPublishedInPeriod = Number(changelogResult[0]?.publishedInPeriod ?? 0)

    // -- CSAT (live query; chat volume is low, no materialized view needed) --
    // Pull rated conversations across current + previous window in one go, then
    // split for the trend + period-over-period delta.
    const csatRows = await db
      .select({ rating: conversations.csatRating, ratedAt: conversations.csatSubmittedAt })
      .from(conversations)
      .where(
        and(isNotNull(conversations.csatRating), gte(conversations.csatSubmittedAt, previousStart))
      )

    const ratedAtOrNow = (r: { ratedAt: Date | null }) => r.ratedAt ?? now
    const csatCurrentRows = csatRows
      .filter((r) => ratedAtOrNow(r) >= start)
      .map((r) => ({ rating: r.rating as number, ratedAt: r.ratedAt as Date }))
    const csatPreviousRows = csatRows
      .filter((r) => ratedAtOrNow(r) >= previousStart && ratedAtOrNow(r) < start)
      .map((r) => ({ rating: r.rating as number, ratedAt: r.ratedAt as Date }))

    const csatSummary = summarizeCsat(csatCurrentRows)
    const prevAvg = summarizeCsat(csatPreviousRows).avgRating

    // Response rate = ratings collected / conversations closed in the period
    // (a closed thread is the chance to be rated).
    const [{ closedCount } = { closedCount: 0 }] = await db
      .select({ closedCount: sql<number>`count(*)::int` })
      .from(conversations)
      .where(and(isNotNull(conversations.resolvedAt), gte(conversations.resolvedAt, start)))
    // Cap at 100: the rated-window (csatSubmittedAt) and closed-window
    // (resolvedAt) can drift at the period edge, so the ratio can exceed 1.
    const responseRate =
      closedCount > 0
        ? Math.min(100, Math.round((csatSummary.responseCount / closedCount) * 100))
        : 0

    // -- Computed at timestamp --
    const computedAt = latestRow?.computedAt?.toISOString() ?? null

    return {
      summary,
      dailyStats,
      statusDistribution,
      resolutionRate,
      followers,
      boardBreakdown,
      topPosts,
      topContributors,
      contributorCount,
      totalActivity,
      csat: {
        avgRating: csatSummary.avgRating,
        avgRatingDelta: delta(csatSummary.avgRating, prevAvg),
        responseCount: csatSummary.responseCount,
        responseRate,
        distribution: csatSummary.distribution,
      },
      changelog: {
        totalViews,
        publishedCount: changelogPublishedCount,
        publishedInPeriod: changelogPublishedInPeriod,
        topEntries: topChangelogEntries.map((e) => ({
          id: e.id,
          title: e.title,
          viewCount: e.viewCount,
        })),
      },
      computedAt,
    }
  })
