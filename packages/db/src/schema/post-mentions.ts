import { pgTable, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { posts } from './posts'
import { principal } from './auth'

/**
 * Join table: records every @-mention of a principal inside a post body.
 *
 * Used by the post.mentioned notification pipeline and the in-app
 * "mentioned me" feed. Insert-once-per-(post, principal); `notifiedAt`
 * is set when the notification has been delivered so re-edits of the
 * same post don't fire duplicate notifications for the same target.
 */
export const postMentions = pgTable(
  'post_mentions',
  {
    id: typeIdWithDefault('post_mention')('id').primaryKey(),
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('post_mentions_post_principal_uq').on(t.postId, t.principalId),
    index('post_mentions_principal_idx').on(t.principalId, t.createdAt.desc()),
  ]
)

export const postMentionsRelations = relations(postMentions, ({ one }) => ({
  post: one(posts, {
    fields: [postMentions.postId],
    references: [posts.id],
  }),
  principal: one(principal, {
    fields: [postMentions.principalId],
    references: [principal.id],
  }),
}))

export type PostMention = typeof postMentions.$inferSelect
export type NewPostMention = typeof postMentions.$inferInsert
