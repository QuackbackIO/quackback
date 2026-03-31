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
  gte,
  isNull,
  sum,
  desc,
  analyticsDailyStats,
  analyticsTopPosts,
  postStatuses,
  changelogEntries,
  boards,
} from '@/lib/server/db'
import { requireAuth } from './auth-helpers'

export const getAnalyticsData = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ period: z.enum(['7d', '30d', '90d', '12m']) }))
  .handler(async ({ data: { period } }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    // -- Date ranges --
    const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365
    const now = new Date()
    const start = new Date(now.getTime() - days * 86_400_000)
    const previousStart = new Date(start.getTime() - days * 86_400_000)

    const startStr = start.toISOString().slice(0, 10)
    const previousStartStr = previousStart.toISOString().slice(0, 10)

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
      .select({ slug: postStatuses.slug, name: postStatuses.name, color: postStatuses.color })
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

    // -- Top 5 contributors (live query, small result set) --
    // Use ISO string to ensure PostgreSQL receives a valid timestamptz literal
    const sinceIso = start.toISOString()
    const contributorRows = await db.execute(sql`
      SELECT
        p.id as "principalId",
        p.display_name as "displayName",
        p.avatar_url as "avatarUrl",
        COALESCE(post_counts.cnt, 0)::int as posts,
        COALESCE(vote_counts.cnt, 0)::int as votes,
        COALESCE(comment_counts.cnt, 0)::int as comments,
        (COALESCE(post_counts.cnt, 0) + COALESCE(vote_counts.cnt, 0) + COALESCE(comment_counts.cnt, 0))::int as total
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

    const topContributors = (
      contributorRows as unknown as Array<{
        principalId: string
        displayName: string | null
        avatarUrl: string | null
        posts: number
        votes: number
        comments: number
        total: number
      }>
    ).map((r) => ({
      principalId: r.principalId,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      posts: r.posts,
      votes: r.votes,
      comments: r.comments,
      total: r.total,
    }))

    // -- Changelog stats (single transaction to keep totalViews consistent with topEntries) --
    const [changelogResult, topChangelogEntries] = await db.transaction(async (tx) => {
      const totals = await tx
        .select({ totalViews: sum(changelogEntries.viewCount) })
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

    // -- Computed at timestamp --
    const computedAt = latestRow?.computedAt?.toISOString() ?? null

    return {
      summary,
      dailyStats,
      statusDistribution,
      boardBreakdown,
      topPosts,
      topContributors,
      changelog: {
        totalViews,
        totalReactions: 0,
        topEntries: topChangelogEntries.map((e) => ({
          id: e.id,
          title: e.title,
          viewCount: e.viewCount,
        })),
      },
      computedAt,
    }
  })
