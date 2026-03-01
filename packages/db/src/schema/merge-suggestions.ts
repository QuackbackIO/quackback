import { pgTable, text, timestamp, real, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { posts } from './posts'
import { principal } from './auth'

export const mergeSuggestions = pgTable(
  'merge_suggestions',
  {
    id: typeIdWithDefault('merge_sug')('id').primaryKey(),
    // The smaller post (to be merged away)
    sourcePostId: typeIdColumn('post')('source_post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    // The larger canonical post (to keep)
    targetPostId: typeIdColumn('post')('target_post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted', 'dismissed', 'expired'] })
      .notNull()
      .default('pending'),
    // Score components
    vectorScore: real('vector_score').notNull(),
    ftsScore: real('fts_score').notNull(),
    hybridScore: real('hybrid_score').notNull(),
    // LLM verification
    llmConfidence: real('llm_confidence').notNull(),
    llmReasoning: text('llm_reasoning'),
    llmModel: text('llm_model'),
    // Resolution
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByPrincipalId: typeIdColumnNullable('principal')('resolved_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('merge_suggestions_source_post_idx').on(t.sourcePostId),
    index('merge_suggestions_target_post_idx').on(t.targetPostId),
    index('merge_suggestions_status_idx').on(t.status),
    index('merge_suggestions_created_idx').on(t.createdAt),
    // Only one pending suggestion per source+target pair
    uniqueIndex('merge_suggestions_pending_unique_idx')
      .on(t.sourcePostId, t.targetPostId)
      .where(sql`${t.status} = 'pending'`),
  ]
)

export const mergeSuggestionsRelations = relations(mergeSuggestions, ({ one }) => ({
  sourcePost: one(posts, {
    fields: [mergeSuggestions.sourcePostId],
    references: [posts.id],
    relationName: 'mergeSuggestionSource',
  }),
  targetPost: one(posts, {
    fields: [mergeSuggestions.targetPostId],
    references: [posts.id],
    relationName: 'mergeSuggestionTarget',
  }),
  resolvedBy: one(principal, {
    fields: [mergeSuggestions.resolvedByPrincipalId],
    references: [principal.id],
    relationName: 'mergeSuggestionResolver',
  }),
}))
