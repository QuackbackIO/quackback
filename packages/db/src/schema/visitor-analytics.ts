import { pgTable, text, timestamp, date, integer, index, primaryKey } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'

/**
 * Raw pageview events for visitor analytics.
 *
 * Declaratively range-partitioned by day on occurred_at: the partition DDL
 * lives in the hand-written migration, and day partitions are pre-created and
 * dropped past the retention window by the daily maintenance job. Rows hold
 * only derived fields — the raw IP and User-Agent are used transiently to
 * compute visitor_hash and the device columns, then discarded.
 */
export const pageViews = pgTable(
  'page_views',
  {
    id: typeIdWithDefault('pv')('id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** The surface's origin (portal origin, or the widget host page's origin). */
    siteOrigin: text('site_origin').notNull(),
    surface: text('surface', { enum: ['portal', 'widget'] }).notNull(),
    path: text('path').notNull(),
    /** Referrer domain or UTM-derived source; null = direct. */
    source: text('source'),
    /** ISO-2 country from CDN headers; null = unknown. */
    country: text('country'),
    device: text('device'),
    browser: text('browser'),
    os: text('os'),
    /** Daily-salted hash(salt + site_origin + ip + ua); unlinkable across days. */
    visitorHash: text('visitor_hash').notNull(),
    /** Layer-2 durable device id (opt-in); null under cookieless layer 1. */
    deviceId: text('device_id'),
    /** Soft link (no FK), set once the visitor engages (layer 2). */
    principalId: typeIdColumnNullable('principal')('principal_id'),
  },
  (t) => [
    // The partition column must be part of the PK on a partitioned table.
    primaryKey({ columns: [t.occurredAt, t.id] }),
    index('page_views_path_occurred_idx').on(t.path, t.occurredAt),
  ]
)

/** Surface values stored on rollup rows; 'all' is the cross-surface aggregate. */
export const VISITOR_SURFACES = ['all', 'portal', 'widget'] as const

/** Breakdown dimensions snapshotted into visitor_top_stats. */
export const VISITOR_TOP_DIMENSIONS = [
  'page',
  'source',
  'country',
  'device',
  'browser',
  'os',
] as const

/**
 * Pre-aggregated daily visitor stats, one row per (date, surface) with a
 * surface='all' aggregate row. Refreshed hourly by the analytics BullMQ job;
 * historical rows are immutable, only today's rows are recomputed.
 */
export const visitorStatsDaily = pgTable(
  'visitor_stats_daily',
  {
    date: date('date', { mode: 'string' }).notNull(),
    surface: text('surface').notNull(), // 'all' | 'portal' | 'widget'
    uniqueVisitors: integer('unique_visitors').default(0).notNull(),
    pageviews: integer('pageviews').default(0).notNull(),
    /** Sessions: a visit ends after 30 minutes of inactivity. */
    visits: integer('visits').default(0).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.surface] })]
)

/**
 * Top-N breakdown snapshot per preset period, surface, and dimension.
 * Refreshed hourly; top 10 rows per (period, surface, dimension).
 */
export const visitorTopStats = pgTable(
  'visitor_top_stats',
  {
    period: text('period').notNull(), // '7d' | '30d' | '90d' | '12m'
    surface: text('surface').notNull(), // 'all' | 'portal' | 'widget'
    dimension: text('dimension').notNull(), // VISITOR_TOP_DIMENSIONS
    rank: integer('rank').notNull(), // 1-10
    label: text('label').notNull(),
    count: integer('count').default(0).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.period, t.surface, t.dimension, t.rank] })]
)
