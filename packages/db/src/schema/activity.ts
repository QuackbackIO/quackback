import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { posts } from './posts'
import { principal } from './auth'

/**
 * Post activity log — tracks all meaningful state changes on posts.
 *
 * Each row represents a single activity event: status change, merge, tag update, etc.
 * The principal_id records who performed the action (null for system-initiated actions).
 * Type-specific details are stored in the metadata JSONB column.
 */
export const postActivity = pgTable(
  'post_activity',
  {
    id: typeIdWithDefault('activity')('id').primaryKey(),
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('post_activity_post_id_created_idx').on(t.postId, t.createdAt),
    index('post_activity_type_idx').on(t.type),
  ]
)

export const postActivityRelations = relations(postActivity, ({ one }) => ({
  post: one(posts, {
    fields: [postActivity.postId],
    references: [posts.id],
    relationName: 'postActivity',
  }),
  actor: one(principal, {
    fields: [postActivity.principalId],
    references: [principal.id],
    relationName: 'activityActor',
  }),
}))
