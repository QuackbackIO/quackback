import { pgTable, varchar, integer, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'

export const aiUsageLog = pgTable(
  'ai_usage_log',
  {
    id: typeIdWithDefault('ailog')('id').primaryKey(),
    pipelineStep: varchar('pipeline_step', { length: 30 }).notNull(),
    callType: varchar('call_type', { length: 20 }).notNull(),
    model: varchar('model', { length: 100 }).notNull(),

    rawFeedbackItemId: typeIdColumnNullable('raw_feedback')('raw_feedback_item_id'),
    signalId: typeIdColumnNullable('feedback_signal')('signal_id'),
    postId: typeIdColumnNullable('post')('post_id'),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens'),
    totalTokens: integer('total_tokens').notNull().default(0),

    durationMs: integer('duration_ms').notNull(),
    retryCount: integer('retry_count').notNull().default(0),

    status: varchar('status', { length: 10 }).notNull().default('success'),
    error: text('error'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_usage_log_step_idx').on(t.pipelineStep),
    index('ai_usage_log_created_idx').on(t.createdAt),
    index('ai_usage_log_raw_item_idx').on(t.rawFeedbackItemId),
  ]
)
