import { pgTable, text, timestamp, integer, real, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { posts } from './posts'

/**
 * Post sentiment analysis results (one-to-one with posts).
 */
export const postSentiment = pgTable(
  'post_sentiment',
  {
    id: typeIdWithDefault('sentiment')('id').primaryKey(),
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .unique()
      .references(() => posts.id, { onDelete: 'cascade' }),
    sentiment: text('sentiment', { enum: ['positive', 'neutral', 'negative'] }).notNull(),
    confidence: real('confidence').notNull(),
    model: text('model').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
  },
  (table) => [
    index('post_sentiment_processed_at_idx').on(table.processedAt),
    index('post_sentiment_sentiment_idx').on(table.sentiment),
  ]
)

export const postSentimentRelations = relations(postSentiment, ({ one }) => ({
  post: one(posts, {
    fields: [postSentiment.postId],
    references: [posts.id],
  }),
}))

export type PostSentiment = typeof postSentiment.$inferSelect
export type NewPostSentiment = typeof postSentiment.$inferInsert
