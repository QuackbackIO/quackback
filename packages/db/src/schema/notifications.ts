import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  varchar,
  jsonb,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { posts, comments } from './posts'
import { member } from './auth'

/**
 * Post subscriptions - tracks which users are subscribed to which posts.
 * Users are auto-subscribed when they create, vote on, or comment on a post.
 *
 * Notification levels controlled by:
 * - notifyComments: receive notifications when someone comments
 * - notifyStatusChanges: receive notifications when status changes
 *
 * "All activity" = both true
 * "Status changes only" = notifyComments=false, notifyStatusChanges=true
 * "Unsubscribed" = row deleted
 */
export const postSubscriptions = pgTable(
  'post_subscriptions',
  {
    id: typeIdWithDefault('post_sub')('id').primaryKey(),
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    memberId: typeIdColumn('member')('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 20 }).notNull(), // 'author' | 'vote' | 'comment' | 'manual'
    notifyComments: boolean('notify_comments').default(true).notNull(),
    notifyStatusChanges: boolean('notify_status_changes').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Unique constraint: one subscription per member per post
    uniqueIndex('post_subscriptions_unique').on(table.postId, table.memberId),
    index('post_subscriptions_member_idx').on(table.memberId),
    index('post_subscriptions_post_idx').on(table.postId),
    // Partial index for comment notification lookups
    index('post_subscriptions_post_comments_idx')
      .on(table.postId)
      .where(sql`notify_comments = true`),
    // Partial index for status change notification lookups
    index('post_subscriptions_post_status_idx')
      .on(table.postId)
      .where(sql`notify_status_changes = true`),
  ]
)

/**
 * Notification preferences - per-member email notification settings.
 * Each member has one preferences record.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: typeIdWithDefault('notif_pref')('id').primaryKey(),
    memberId: typeIdColumn('member')('member_id')
      .notNull()
      .unique()
      .references(() => member.id, { onDelete: 'cascade' }),
    emailStatusChange: boolean('email_status_change').default(true).notNull(),
    emailNewComment: boolean('email_new_comment').default(true).notNull(),
    emailMuted: boolean('email_muted').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('notification_preferences_member_idx').on(table.memberId)]
)

/**
 * Unsubscribe tokens - one-time tokens for email unsubscribe links.
 * Tokens expire after 30 days and are invalidated after use.
 */
export const unsubscribeTokens = pgTable(
  'unsubscribe_tokens',
  {
    id: typeIdWithDefault('unsub_token')('id').primaryKey(),
    token: text('token').notNull().unique(),
    memberId: typeIdColumn('member')('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    postId: typeIdColumnNullable('post')('post_id').references(() => posts.id, {
      onDelete: 'cascade',
    }), // null = global unsubscribe
    action: varchar('action', { length: 30 }).notNull(), // 'unsubscribe_post' | 'unsubscribe_all' | 'mute_post'
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('unsubscribe_tokens_token_idx').on(table.token),
    index('unsubscribe_tokens_member_idx').on(table.memberId),
  ]
)

// Relations
export const postSubscriptionsRelations = relations(postSubscriptions, ({ one }) => ({
  post: one(posts, {
    fields: [postSubscriptions.postId],
    references: [posts.id],
  }),
  member: one(member, {
    fields: [postSubscriptions.memberId],
    references: [member.id],
  }),
}))

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  member: one(member, {
    fields: [notificationPreferences.memberId],
    references: [member.id],
  }),
}))

export const unsubscribeTokensRelations = relations(unsubscribeTokens, ({ one }) => ({
  member: one(member, {
    fields: [unsubscribeTokens.memberId],
    references: [member.id],
  }),
  post: one(posts, {
    fields: [unsubscribeTokens.postId],
    references: [posts.id],
  }),
}))

/**
 * In-app notifications - tracks notifications displayed in the UI.
 * Created when events occur (status changes, comments, etc.) for subscribed users.
 */
export const inAppNotifications = pgTable(
  'in_app_notifications',
  {
    id: typeIdWithDefault('notification')('id').primaryKey(),
    memberId: typeIdColumn('member')('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(), // 'post_status_changed', 'comment_created'
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    postId: typeIdColumnNullable('post')('post_id').references(() => posts.id, {
      onDelete: 'cascade',
    }),
    commentId: typeIdColumnNullable('comment')('comment_id').references(() => comments.id, {
      onDelete: 'cascade',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    readAt: timestamp('read_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Primary lookup: member's notifications ordered by date
    index('in_app_notifications_member_created_idx').on(table.memberId, table.createdAt),
    // Unread notifications for badge count (partial index)
    index('in_app_notifications_member_unread_idx')
      .on(table.memberId)
      .where(sql`read_at IS NULL AND archived_at IS NULL`),
    // Find notifications by related post
    index('in_app_notifications_post_idx').on(table.postId),
  ]
)

export const inAppNotificationsRelations = relations(inAppNotifications, ({ one }) => ({
  member: one(member, {
    fields: [inAppNotifications.memberId],
    references: [member.id],
  }),
  post: one(posts, {
    fields: [inAppNotifications.postId],
    references: [posts.id],
  }),
  comment: one(comments, {
    fields: [inAppNotifications.commentId],
    references: [comments.id],
  }),
}))
