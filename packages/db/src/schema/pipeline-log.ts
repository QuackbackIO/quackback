import { pgTable, varchar, timestamp, jsonb, index, foreignKey } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { rawFeedbackItems, feedbackSignals, feedbackSuggestions } from './feedback'
import { posts } from './posts'

export const pipelineLog = pgTable(
  'pipeline_log',
  {
    id: typeIdWithDefault('plog')('id').primaryKey(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    rawFeedbackItemId: typeIdColumnNullable('raw_feedback')('raw_feedback_item_id'),
    signalId: typeIdColumnNullable('feedback_signal')('signal_id'),
    suggestionId: typeIdColumnNullable('feedback_suggestion')('suggestion_id'),
    postId: typeIdColumnNullable('post')('post_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // FK names match the constraints the SQL migration created.
    foreignKey({
      name: 'pipeline_log_raw_feedback_item_id_fkey',
      columns: [t.rawFeedbackItemId],
      foreignColumns: [rawFeedbackItems.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'pipeline_log_signal_id_fkey',
      columns: [t.signalId],
      foreignColumns: [feedbackSignals.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'pipeline_log_suggestion_id_fkey',
      columns: [t.suggestionId],
      foreignColumns: [feedbackSuggestions.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'pipeline_log_post_id_fkey',
      columns: [t.postId],
      foreignColumns: [posts.id],
    }).onDelete('set null'),
    index('pipeline_log_raw_item_idx').on(t.rawFeedbackItemId),
    index('pipeline_log_event_type_idx').on(t.eventType),
    index('pipeline_log_created_idx').on(t.createdAt),
  ]
)
