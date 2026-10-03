/**
 * The analytics dashboard's reads. Every query depends only on the date range,
 * never on another query's result, so they all run concurrently: the batch
 * resolves in the time of the slowest single query instead of the sum.
 */
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
import { notTestPrincipal, notTestConversation } from '@/lib/server/test-data'

export interface DashboardRange {
  period: '7d' | '30d' | '90d' | '12m'
  now: Date
  start: Date
  previousStart: Date
  previousStartStr: string
  sinceIso: string
}

export function queryDashboardRows({
  period,
  now,
  start,
  previousStart,
  previousStartStr,
  sinceIso,
}: DashboardRange) {
  return Promise.all([
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
        AND ${notTestPrincipal(sql`p.principal_id`)}
        AND ${notTestPrincipal(sql`psub.principal_id`)}
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
        FROM post_comments c
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
        AND ${notTestPrincipal(sql`p.principal_id`)}
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
        SELECT v.principal_id as pid, COUNT(*)::int as cnt
        FROM post_votes v JOIN posts activity_post ON activity_post.id = v.post_id
        WHERE v.created_at >= ${sinceIso}::timestamptz AND ${notTestPrincipal(sql`activity_post.principal_id`)}
        GROUP BY v.principal_id
      ) vote_counts ON vote_counts.pid = p.id
      LEFT JOIN (
        SELECT c.principal_id as pid, COUNT(*)::int as cnt
        FROM post_comments c JOIN posts activity_post ON activity_post.id = c.post_id
        WHERE c.created_at >= ${sinceIso}::timestamptz AND c.deleted_at IS NULL AND ${notTestPrincipal(sql`activity_post.principal_id`)}
        GROUP BY c.principal_id
      ) comment_counts ON comment_counts.pid = p.id
      WHERE p.type != 'anonymous' AND p.role = 'user'
        AND ${notTestPrincipal(sql`p.id`)}
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
          notTestConversation(conversations.id),
          gte(conversations.csatSubmittedAt, previousStart)
        )
      ),

    // Closed-conversation count = the response-rate denominator (a closed
    // thread is the chance to be rated).
    db
      .select({ closedCount: sql<number>`count(*)::int` })
      .from(conversations)
      .where(
        and(
          isNotNull(conversations.resolvedAt),
          gte(conversations.resolvedAt, start),
          notTestConversation(conversations.id)
        )
      ),

    // New leads: engaged-but-unauthenticated principals minted in the
    // current and previous windows (the lifecycle stage before signup).
    db.execute<{ current: number; previous: number }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${sinceIso})::int AS current,
        COUNT(*) FILTER (WHERE created_at < ${sinceIso})::int AS previous
      FROM principal
      WHERE role = 'user' AND type = 'anonymous'
        AND ${notTestPrincipal(sql`principal.id`)}
        AND created_at >= ${previousStart.toISOString()}
    `),

    // New conversations by arrival channel (live query; chat volume is low,
    // like CSAT, so no rollup table). Pulls current + previous windows in one
    // scan; the split into the per-day series and the period-over-period
    // delta happens in memory below.
    db
      .select({ createdAt: conversations.createdAt, source: conversations.source })
      .from(conversations)
      .where(
        and(gte(conversations.createdAt, previousStart), notTestConversation(conversations.id))
      ),

    // First response per conversation (live query; chat volume is low, like
    // CSAT, so no rollup table). One row per conversation that received at
    // least one non-internal agent reply — human or assistant, both post as
    // sender_type 'agent'. Unanswered conversations drop out of the JOIN and
    // are reflected as a gap day, not a zero.
    db.execute<{ createdAt: Date; firstResponseAt: Date }>(sql`
      SELECT c.created_at AS "createdAt", MIN(m.created_at) AS "firstResponseAt"
      FROM conversations c
      JOIN conversation_messages m ON m.conversation_id = c.id
      WHERE c.created_at >= ${sinceIso}::timestamptz
        AND ${notTestConversation(sql`c.id`)}
        AND m.sender_type = 'agent'
        AND m.is_internal = false
        AND m.deleted_at IS NULL
      GROUP BY c.id, c.created_at
    `),

    // Time-to-close per conversation (live query; chat volume is low, like
    // CSAT, so no rollup table). One row per conversation that reached a
    // terminal status in the window — resolved_at is the close moment.
    // Still-open conversations never reach the chart.
    db
      .select({ createdAt: conversations.createdAt, closedAt: conversations.resolvedAt })
      .from(conversations)
      .where(
        and(
          isNotNull(conversations.resolvedAt),
          gte(conversations.resolvedAt, start),
          notTestConversation(conversations.id)
        )
      ),

    // Per-teammate workload (live query; chat volume is low, like CSAT, so
    // no rollup table). One row per agent-assigned conversation that arrived
    // in the window, carrying its first agent reply (lateral MIN, null while
    // unanswered) and its close timestamp (null while open); the grouping and
    // medians happen in memory in buildTeammatePerformance.
    db.execute<{
      agentId: string
      displayName: string | null
      avatarUrl: string | null
      createdAt: Date
      firstResponseAt: Date | null
      closedAt: Date | null
    }>(sql`
      SELECT
        c.assigned_agent_principal_id AS "agentId",
        p.display_name AS "displayName",
        p.avatar_url AS "avatarUrl",
        c.created_at AS "createdAt",
        fr.first_response_at AS "firstResponseAt",
        c.resolved_at AS "closedAt"
      FROM conversations c
      JOIN principal p ON p.id = c.assigned_agent_principal_id
      LEFT JOIN LATERAL (
        SELECT MIN(m.created_at) AS first_response_at
        FROM conversation_messages m
        WHERE m.conversation_id = c.id
          AND m.sender_type = 'agent'
          AND m.is_internal = false
          AND m.deleted_at IS NULL
      ) fr ON true
      WHERE c.created_at >= ${sinceIso}::timestamptz
        AND ${notTestConversation(sql`c.id`)}
        AND c.assigned_agent_principal_id IS NOT NULL
    `),
  ])
}
