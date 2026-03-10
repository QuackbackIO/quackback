import { pgTable, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { rawFeedbackItems, feedbackSignals, feedbackSuggestions } from './feedback'
import { posts } from './posts'

export const pipelineLog = pgTable(
  'pipeline_log',
  {
    id: typeIdWithDefault('plog')('id').primaryKey(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    rawFeedbackItemId: typeIdColumnNullable('raw_feedback')('raw_feedback_item_id').references(
      () => rawFeedbackItems.id,
      { onDelete: 'set null' }
    ),
    signalId: typeIdColumnNullable('feedback_signal')('signal_id').references(
      () => feedbackSignals.id,
      { onDelete: 'set null' }
    ),
    suggestionId: typeIdColumnNullable('feedback_suggestion')('suggestion_id').references(
      () => feedbackSuggestions.id,
      { onDelete: 'set null' }
    ),
    postId: typeIdColumnNullable('post')('post_id').references(() => posts.id, {
      onDelete: 'set null',
    }),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pipeline_log_raw_item_idx').on(t.rawFeedbackItemId),
    index('pipeline_log_event_type_idx').on(t.eventType),
    index('pipeline_log_created_idx').on(t.createdAt),
  ]
)
