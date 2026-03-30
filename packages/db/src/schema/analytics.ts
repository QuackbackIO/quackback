import { pgTable, date, integer, jsonb, timestamp, text, primaryKey } from 'drizzle-orm/pg-core'
import { typeIdColumn } from '@quackback/ids/drizzle'

/**
 * Pre-aggregated daily analytics stats.
 * One row per day, refreshed hourly by the analytics BullMQ job.
 * Historical rows are immutable; only today's row is recomputed.
 */
export const analyticsDailyStats = pgTable('analytics_daily_stats', {
  date: date('date', { mode: 'string' }).primaryKey(),
  newPosts: integer('new_posts').default(0).notNull(),
  newVotes: integer('new_votes').default(0).notNull(),
  newComments: integer('new_comments').default(0).notNull(),
  newUsers: integer('new_users').default(0).notNull(),
  /** Current snapshot of all active posts by status: { "status_slug": count } */
  postsByStatus: jsonb('posts_by_status').$type<Record<string, number>>().default({}).notNull(),
  /** New posts created on this date by board: { "board_id": count } */
  postsByBoard: jsonb('posts_by_board').$type<Record<string, number>>().default({}).notNull(),
  /** New posts created on this date by source: { "portal": n, "widget": n, "api": n } */
  postsBySource: jsonb('posts_by_source').$type<Record<string, number>>().default({}).notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Top posts snapshot per preset period.
 * Refreshed hourly. Stores top 10 posts by vote count for each period.
 */
export const analyticsTopPosts = pgTable(
  'analytics_top_posts',
  {
    period: text('period').notNull(), // '7d', '30d', '90d', '12m'
    rank: integer('rank').notNull(), // 1-10
    postId: typeIdColumn('post')('post_id').notNull(),
    title: text('title').notNull(),
    voteCount: integer('vote_count').default(0).notNull(),
    commentCount: integer('comment_count').default(0).notNull(),
    boardName: text('board_name'),
    statusName: text('status_name'),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.period, table.rank] })]
)
