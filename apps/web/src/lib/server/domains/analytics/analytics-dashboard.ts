/**
 * The analytics dashboard query. Reads from the materialized analytics tables
 * and returns all data the dashboard needs.
 */

import { summarizeCsat } from './csat-summary'
import { buildConversationVolume } from './conversation-volume'
import { buildFirstResponseTimes } from './first-response'
import { buildResponseDistribution } from './response-distribution'
import { buildTeammatePerformance } from './teammate-performance'
import { buildTimeToClose } from './time-to-close'
import { computeResolutionRate } from './resolution'
import { toIsoDateOnly } from '@/lib/shared/utils/date'
import { queryDashboardRows } from './analytics-dashboard.queries'

/** Shared dashboard query; callers enforce the analytics permission. */
export async function loadAnalyticsData(period: '7d' | '30d' | '90d' | '12m') {
  // -- Date ranges --
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365
  const now = new Date()
  const start = new Date(now.getTime() - days * 86_400_000)
  const previousStart = new Date(start.getTime() - days * 86_400_000)

  const startStr = toIsoDateOnly(start)
  const previousStartStr = toIsoDateOnly(previousStart)
  // Full-precision period start for timestamptz comparisons in raw SQL.
  const sinceIso = start.toISOString()

  // -- The reads (independent; derived in memory once they land) --
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
    newLeadsRows,
    conversationCreatedRows,
    firstResponseRows,
    timeToCloseRows,
    teammateRows,
  ] = await queryDashboardRows({
    period,
    now,
    start,
    previousStart,
    previousStartStr,
    sinceIso,
  })

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
    postComments: { total: currentComments, delta: delta(currentComments, prevComments) },
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

  const leadRow = Array.from(newLeadsRows as Iterable<{ current: number; previous: number }>)[0]
  const newLeads = {
    total: leadRow?.current ?? 0,
    delta: delta(leadRow?.current ?? 0, leadRow?.previous ?? 0),
  }

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
    closedCount > 0 ? Math.min(100, Math.round((csatSummary.responseCount / closedCount) * 100)) : 0

  // -- New-conversation volume by arrival channel: current-window rows feed
  // the per-day series; the previous window only supplies the delta. --
  const nowStr = toIsoDateOnly(now)
  const conversationVolume = buildConversationVolume(
    conversationCreatedRows.filter((r) => r.createdAt >= start),
    startStr,
    nowStr
  )
  const prevConversationCount = conversationCreatedRows.filter(
    (r) => r.createdAt >= previousStart && r.createdAt < start
  ).length

  // -- First-response time: per-day median series over the current window.
  // No period-over-period delta: the shared trend badge reads up as good,
  // which is the wrong polarity for a wait time (same reason the median
  // resolve-time stat carries none). --
  const firstResponse = buildFirstResponseTimes(
    Array.from(firstResponseRows as Iterable<{ createdAt: Date; firstResponseAt: Date }>),
    startStr,
    nowStr
  )

  // -- Wait-time distribution: the same first-response rows grouped into
  // fixed ranges (<5m … >3d) for the histogram beneath the trend. --
  const responseDistribution = buildResponseDistribution(
    Array.from(firstResponseRows as Iterable<{ createdAt: Date; firstResponseAt: Date }>),
    startStr,
    nowStr
  )

  // -- Time-to-close: per-day median series over the current window, bucketed
  // on the close day. Same no-delta polarity reasoning as first response. --
  const timeToClose = buildTimeToClose(
    timeToCloseRows as Array<{ createdAt: Date; closedAt: Date }>,
    startStr,
    nowStr
  )

  // -- Per-teammate performance: handled count + median first response and
  // median time to close, sorted by workload for the support table. --
  const teammatePerformance = buildTeammatePerformance(
    Array.from(
      teammateRows as Iterable<{
        agentId: string
        displayName: string | null
        avatarUrl: string | null
        createdAt: Date
        firstResponseAt: Date | null
        closedAt: Date | null
      }>
    )
  )

  // -- Computed at timestamp --
  const computedAt = latestRow?.computedAt?.toISOString() ?? null

  return {
    summary,
    dailyStats,
    statusDistribution,
    resolutionRate,
    medianResolutionDays,
    followers,
    newLeads,
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
    conversationVolume: {
      ...conversationVolume,
      delta: delta(conversationVolume.total, prevConversationCount),
    },
    firstResponse,
    responseDistribution,
    timeToClose,
    teammatePerformance,
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
}
