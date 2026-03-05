import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { posts } from './posts'
import { principal } from './auth'

/**
 * AI signals — unified table for all AI-generated insights.
 *
 * Each signal represents an actionable insight about a post (duplicate detected,
 * sentiment flagged, auto-categorization suggested, etc). Signals surface through
 * progressive disclosure: badges on inbox rows, filter views, and post detail panels.
 */
export const aiSignals = pgTable(
  'ai_signals',
  {
    id: typeIdWithDefault('ai_signal')('id').primaryKey(),
    // What kind of signal
    type: text('type', {
      enum: ['duplicate', 'sentiment', 'categorize', 'trend', 'response_draft'],
    }).notNull(),
    severity: text('severity', { enum: ['info', 'warning', 'urgent'] })
      .notNull()
      .default('info'),
    // What post it relates to
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    // Type-specific payload (flexible JSON)
    payload: jsonb('payload').notNull().default({}),
    // Lifecycle
    status: text('status', { enum: ['pending', 'accepted', 'dismissed', 'expired'] })
      .notNull()
      .default('pending'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByPrincipalId: typeIdColumnNullable('principal')('resolved_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_signals_post_id_idx').on(t.postId),
    index('ai_signals_type_status_idx').on(t.type, t.status),
    index('ai_signals_status_created_idx').on(t.status, t.createdAt),
  ]
)

export const aiSignalsRelations = relations(aiSignals, ({ one }) => ({
  post: one(posts, {
    fields: [aiSignals.postId],
    references: [posts.id],
    relationName: 'aiSignalPost',
  }),
  resolvedBy: one(principal, {
    fields: [aiSignals.resolvedByPrincipalId],
    references: [principal.id],
    relationName: 'aiSignalResolver',
  }),
}))
