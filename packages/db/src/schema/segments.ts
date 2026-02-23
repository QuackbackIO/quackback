/**
 * User Segmentation schema
 *
 * Supports two segment types:
 * - manual: Admin explicitly assigns/removes users
 * - dynamic: Membership is computed from rules and cached in the join table
 *
 * Both types share the same userSegments join table — dynamic segments
 * are treated as a cached result set, evaluated periodically and synced.
 */
import { pgTable, text, timestamp, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { principal } from './auth'
import type { UserAttributeType, CurrencyCode } from './user-attributes'

// ============================================
// Rule types (stored as JSON in dynamic segments)
// ============================================

export type SegmentRuleOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'is_set'
  | 'is_not_set'

export type SegmentRuleAttribute =
  | 'email_domain'
  | 'email_verified'
  | 'created_at_days_ago'
  | 'post_count'
  | 'vote_count'
  | 'comment_count'
  | 'plan'
  | 'metadata_key'

export interface SegmentCondition {
  attribute: SegmentRuleAttribute
  operator: SegmentRuleOperator
  /** Required for value-based operators; omit for is_set / is_not_set */
  value?: string | number | boolean
  /** For metadata_key attribute: the key to look up in user.metadata JSON */
  metadataKey?: string
}

export interface SegmentRules {
  /** 'all' = AND logic; 'any' = OR logic between conditions */
  match: 'all' | 'any'
  conditions: SegmentCondition[]
}

// ============================================
// User attribute types (for segment weighting)
// ============================================

/** Inline attribute reference stored in segment weight config JSON */
export interface UserAttributeDefinition {
  /** The metadata key to read from user.metadata */
  key: string
  /** Human-readable label */
  label: string
  /** Data type — determines parsing and display */
  type: UserAttributeType
  /** For currency type: the ISO 4217 currency code (e.g. 'USD') */
  currencyCode?: CurrencyCode
}

/** Weighting configuration for a segment */
export interface SegmentWeightConfig {
  /** The user attribute to weight by */
  attribute: UserAttributeDefinition
  /** Aggregation method for the attribute across segment members */
  aggregation: 'sum' | 'average' | 'count' | 'median'
}

// ============================================
// Evaluation schedule types
// ============================================

/** Schedule for automatic re-evaluation of dynamic segments */
export interface EvaluationSchedule {
  /** Whether auto-evaluation is enabled */
  enabled: boolean
  /** Cron pattern (e.g. '0 * * * *' for hourly, '0 0 * * *' for daily) */
  pattern: string
}

// ============================================
// Tables
// ============================================

/**
 * Segments table — tenant-scoped user groups
 *
 * type='manual': Members are assigned/removed by admins.
 * type='dynamic': Members are computed from `rules` JSON and cached in user_segments.
 */
export const segments = pgTable(
  'segments',
  {
    id: typeIdWithDefault('segment')('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    /** 'manual' | 'dynamic' */
    type: text('type', { enum: ['manual', 'dynamic'] })
      .notNull()
      .default('manual'),
    /** Optional hex color for UI display (e.g. '#6366f1') */
    color: text('color').default('#6b7280').notNull(),
    /** Rule definition for dynamic segments (null for manual) */
    rules: jsonb('rules').$type<SegmentRules | null>(),
    /** Auto-evaluation schedule for dynamic segments (null = manual only) */
    evaluationSchedule: jsonb('evaluation_schedule').$type<EvaluationSchedule | null>(),
    /** Weighting config for segment-level analytics (e.g. weight by MRR) */
    weightConfig: jsonb('weight_config').$type<SegmentWeightConfig | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('segments_type_idx').on(table.type),
    index('segments_deleted_at_idx').on(table.deletedAt),
  ]
)

/**
 * User-segment join table
 *
 * Shared by both manual and dynamic segments.
 * For dynamic segments this is the evaluation cache, rebuilt on each evaluation run.
 *
 * Uses principalId as the user identifier (principal with role='user').
 */
export const userSegments = pgTable(
  'user_segments',
  {
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    segmentId: typeIdColumn('segment')('segment_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    /** 'manual' = explicitly assigned; 'dynamic' = computed by evaluator */
    addedBy: text('added_by', { enum: ['manual', 'dynamic'] })
      .notNull()
      .default('manual'),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_segments_pk').on(table.principalId, table.segmentId),
    index('user_segments_principal_id_idx').on(table.principalId),
    index('user_segments_segment_id_idx').on(table.segmentId),
  ]
)

// ============================================
// Relations
// ============================================

export const segmentsRelations = relations(segments, ({ many }) => ({
  members: many(userSegments),
}))

export const userSegmentsRelations = relations(userSegments, ({ one }) => ({
  segment: one(segments, {
    fields: [userSegments.segmentId],
    references: [segments.id],
  }),
  principal: one(principal, {
    fields: [userSegments.principalId],
    references: [principal.id],
  }),
}))
