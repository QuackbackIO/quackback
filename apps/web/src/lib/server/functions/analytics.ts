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
  lte,
  isNull,
  isNotNull,
  desc,
  analyticsDailyStats,
  analyticsTopPosts,
  postStatuses,
  changelogEntries,
  conversations,
  boards,
} from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { summarizeCsat } from '@/lib/server/domains/analytics/csat-summary'
import { computeResolutionRate } from '@/lib/server/domains/analytics/resolution'
import { toIsoDateOnly } from '@/lib/shared/utils/date'

export const getAnalyticsData = createServerFn({ method: 'GET' })
  .validator(z.object({ period: z.enum(['7d', '30d', '90d', '12m']) }))
  .handler(async ({ data: { period } }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })

    // -- Date ranges --
    const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365
    const now = new Date()
    const start = new Date(now.getTime() - days * 86_400_000)
    const previousStart = new Date(start.getTime() - days * 86_400_000)

    const startStr = toIsoDateOnly(start)
    const previousStartStr = toIsoDateOnly(previousStart)
    // Full-precision period start for timestamptz comparisons in raw SQL.
    const sinceIso = start.toISOString()

    // -- Every query below depends only on the pure date/period values above,
    // never on another query's result, so they all run concurrently. The whole
    // batch resolves in the time of the slowest single query instead of the sum;
    // the derivations that combine the results happen in memory once it lands. --
    const [
      allRows,
      statusColors,
      allBoards,
      followersRows,
      ttrRows,
      topPostRows,
      contributorRows,
      signupsBySource,
      activeUsersRows,
      verifiedRows,
      [changelogResult, topChangelogEntries],
      csatRows,
      closedRows,
    ] = await Promise.all([
      // Daily stats for current + previous periods (one scan, split in memory).
      db
        .select()
        .from(analyticsDailyStats)
        .where(gte(analyticsDailyStats.date, previousStartStr))
        .orderBy(analyticsDailyStats.date),

      // Status metadata (name, color, category) for the distribution + resolution.
      db
        .select({
          slug: postStatuses.slug,
          name: postStatuses.name,
          color: postStatuses.color,
          category: postStatuses.category,
        })
        .from(postStatuses),

      // Board names for the board breakdown.
      db.select({ id: boards.id, name: boards.name }).from(boards),

      // Followers: distinct people watching at least one live post. A demand
      // signal; current total, not period-scoped. Excludes subscriptions to
      // soft-deleted posts (consistent with the rest of this file).
      db.execute<{ followers: number }>(sql`
        SELECT COUNT(DISTINCT psub.principal_id)::int AS followers
        FROM post_subscriptions psub
        JOIN posts p ON p.id = psub.post_id
        WHERE p.deleted_at IS NULL
      `),

      // Median time-to-resolution (days) for posts that first reached a terminal
      // status within the period. Status changes land in post_activity as a
      // 'status.changed' row (matched by slug, or by name for legacy rows). The
      // comment table is unioned as well so historical comment-carried status
      // changes (recorded before comment.service emitted activity) are still
      // counted; MIN keeps the first transition per post regardless of source.
      db.execute<{ medianDays: number | null }>(sql`
        WITH transitions AS (
          SELECT pa.post_id, pa.created_at
          FROM post_activity pa
          JOIN post_statuses ps ON (
            ps.slug = (pa.metadata->>'toSlug')
            OR (pa.metadata->>'toSlug' IS NULL AND ps.name = (pa.metadata->>'toName'))
          )
          WHERE pa.type = 'status.changed' AND ps.category IN ('complete', 'closed')
          UNION ALL
          SELECT c.post_id, c.created_at
          FROM comments c
          JOIN post_statuses ps ON ps.id = c.status_change_to_id
          WHERE c.deleted_at IS NULL AND ps.category IN ('complete', 'closed')
        ),
        first_resolution AS (
          SELECT post_id, MIN(created_at) AS resolved_at FROM transitions GROUP BY post_id
        )
        SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (fr.resolved_at - p.created_at)) / 86400.0
        )::float AS "medianDays"
        FROM first_resolution fr
        JOIN posts p ON p.id = fr.post_id
        WHERE fr.resolved_at >= ${sinceIso}::timestamptz AND p.deleted_at IS NULL
      `),

      // Top posts (pre-materialized per period).
      db
        .select()
        .from(analyticsTopPosts)
        .where(eq(analyticsTopPosts.period, period))
        .orderBy(analyticsTopPosts.rank),

      // Top 5 contributors + period-wide count in one pass. The window aggregate
      // runs over every contributor that passes WHERE (before ORDER BY/LIMIT), so
      // each of the top-5 rows also carries the full contributor count.
      db.execute<{
        principalId: string
        displayName: string | null
        avatarUrl: string | null
        posts: number
        votes: number
        comments: number
        total: number
        contributorCount: number
      }>(sql`
        SELECT
          p.id as "principalId",
          p.display_name as "displayName",
          p.avatar_url as "avatarUrl",
          COALESCE(post_counts.cnt, 0)::int as posts,
          COALESCE(vote_counts.cnt, 0)::int as votes,
          COALESCE(comment_counts.cnt, 0)::int as comments,
          (COALESCE(post_counts.cnt, 0) + COALESCE(vote_counts.cnt, 0) + COALESCE(comment_counts.cnt, 0))::int as total,
          (COUNT(*) OVER ())::int as "contributorCount"
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
      `),

      // Signups by source: acquisition channel of portal users who signed up in
      // the period. A user's source is their earliest account's provider (the
      // account_userId_createdAt index supports exactly this lookup).
      db.execute<{ source: string; count: number }>(sql`
        SELECT
          CASE
            WHEN src.provider IS NULL OR src.provider = 'credential' THEN 'Email'
            WHEN src.provider = 'sso' THEN 'SSO'
            ELSE INITCAP(src.provider)
          END as source,
          COUNT(*)::int as count
        FROM principal p
        LEFT JOIN LATERAL (
          SELECT a.provider_id as provider
          FROM account a
          WHERE a.user_id = p.user_id
          ORDER BY a.created_at ASC
          LIMIT 1
        ) src ON true
        WHERE p.created_at >= ${sinceIso}::timestamptz
          AND p.type != 'anonymous' AND p.role = 'user'
        GROUP BY 1
        ORDER BY count DESC
      `),

      // Active users: distinct portal users with a session active in the period
      // (session.updated_at is refreshed on activity). A truer engagement signal
      // than "contributors", which only counts people who posted/voted/commented.
      db.execute<{ activeUsers: number }>(sql`
        SELECT COUNT(DISTINCT p.id)::int AS "activeUsers"
        FROM session s
        JOIN principal p ON p.user_id = s.user_id
        WHERE s.updated_at >= ${sinceIso}::timestamptz
          AND p.type != 'anonymous' AND p.role = 'user'
      `),

      // Verified rate: share of portal users who confirmed their email. An
      // activation-health snapshot (all-time, not period-scoped).
      db.execute<{ verifiedCount: number; userCount: number }>(sql`
        SELECT
          COUNT(*) FILTER (WHERE u.email_verified)::int AS "verifiedCount",
          COUNT(*)::int AS "userCount"
        FROM principal p
        JOIN "user" u ON u.id = p.user_id
        WHERE p.type != 'anonymous' AND p.role = 'user'
      `),

      // Changelog stats, in one transaction so totalViews stays consistent with
      // the top-entries snapshot.
      db.transaction(async (tx) => {
        const totals = await tx
          .select({
            // Views of published entries only, so the total and the "avg / entry"
            // denominator share one scope. An entry unpublished after accruing
            // public views would otherwise inflate the total against a count that
            // excludes it.
            totalViews: sql<number>`COALESCE(sum(${changelogEntries.viewCount}) FILTER (WHERE ${changelogEntries.publishedAt} IS NOT NULL AND ${changelogEntries.publishedAt} <= ${now.toISOString()}::timestamptz), 0)::int`,
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
          // Published entries only — a draft (incl. one unpublished after it was
          // live) must not surface in the public top-entries list.
          .where(
            and(
              isNull(changelogEntries.deletedAt),
              isNotNull(changelogEntries.publishedAt),
              lte(changelogEntries.publishedAt, now)
            )
          )
          .orderBy(desc(changelogEntries.viewCount))
          .limit(5)
        return [totals, top] as const
      }),

      // CSAT (live query; chat volume is low, no materialized view needed). Pull
      // rated conversations across current + previous window in one go, then
      // split for the trend + period-over-period delta below.
      db
        .select({ rating: conversations.csatRating, ratedAt: conversations.csatSubmittedAt })
        .from(conversations)
        .where(
          and(
            isNotNull(conversations.csatRating),
            gte(conversations.csatSubmittedAt, previousStart)
          )
        ),

      // Closed-conversation count = the response-rate denominator (a closed
      // thread is the chance to be rated).
      db
        .select({ closedCount: sql<number>`count(*)::int` })
        .from(conversations)
        .where(and(isNotNull(conversations.resolvedAt), gte(conversations.resolvedAt, start))),
    ])

    // -- Period split for the daily-stats rollup --
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

    const boardNameMap = new Map(allBoards.map((b) => [b.id, b.name]))

    const boardBreakdown = Array.from(boardTotals.entries())
      .map(([boardId, count]) => ({
        board: boardNameMap.get(boardId as never) ?? boardId,
        count,
      }))
      .sort((a, b) => b.count - a.count)

    const { followers } = followersRows[0] ?? { followers: 0 }

    const medianResolutionDays = ttrRows[0]?.medianDays ?? null

    // -- Top posts --
    const topPosts = topPostRows.map((r) => ({
      rank: r.rank,
      postId: r.postId,
      title: r.title,
      voteCount: r.voteCount,
      commentCount: r.commentCount,
      boardName: r.boardName,
      statusName: r.statusName,
    }))

    // -- Top 5 contributors + period-wide count (window aggregate) --
    const topContributors = contributorRows.map((r) => ({
      principalId: r.principalId,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      posts: r.posts,
      votes: r.votes,
      comments: r.comments,
      total: r.total,
    }))

    // The window aggregate is identical on every row; read it off the first
    // (0 contributors → no rows → fall back to 0).
    const contributorCount = contributorRows[0]?.contributorCount ?? 0

    const { activeUsers } = activeUsersRows[0] ?? { activeUsers: 0 }

    const { verifiedCount = 0, userCount = 0 } = verifiedRows[0] ?? {}
    const verifiedRate = userCount > 0 ? Math.round((verifiedCount / userCount) * 100) : 0

    const totalViews = Number(changelogResult[0]?.totalViews ?? 0)
    const changelogPublishedCount = Number(changelogResult[0]?.publishedCount ?? 0)
    const changelogPublishedInPeriod = Number(changelogResult[0]?.publishedInPeriod ?? 0)

    // -- CSAT: split the rated window for the trend + period-over-period delta --
    const ratedAtOrNow = (r: { ratedAt: Date | null }) => r.ratedAt ?? now
    const csatCurrentRows = csatRows
      .filter((r) => ratedAtOrNow(r) >= start)
      .map((r) => ({ rating: r.rating as number, ratedAt: r.ratedAt as Date }))
    const csatPreviousRows = csatRows
      .filter((r) => ratedAtOrNow(r) >= previousStart && ratedAtOrNow(r) < start)
      .map((r) => ({ rating: r.rating as number, ratedAt: r.ratedAt as Date }))

    const csatSummary = summarizeCsat(csatCurrentRows)
    const prevAvg = summarizeCsat(csatPreviousRows).avgRating

    // Response rate = ratings collected / conversations closed in the period.
    const { closedCount } = closedRows[0] ?? { closedCount: 0 }
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
      medianResolutionDays,
      followers,
      boardBreakdown,
      topPosts,
      topContributors,
      contributorCount,
      activeUsers,
      verifiedRate,
      signupsBySource,
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
