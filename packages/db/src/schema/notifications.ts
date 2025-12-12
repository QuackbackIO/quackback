import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'
import { posts } from './posts'
import { member } from './auth'
import { appUser } from './rls'

/**
 * RLS check for post_subscriptions via post -> board -> organization
 */
const subscriptionsOrgCheck = sql`post_id IN (
  SELECT p.id FROM posts p
  JOIN boards b ON p.board_id = b.id
  WHERE b.organization_id = current_setting('app.organization_id', true)
)`

/**
 * RLS check for notification_preferences via member -> organization
 */
const preferencesOrgCheck = sql`member_id IN (
  SELECT id FROM member
  WHERE organization_id = current_setting('app.organization_id', true)
)`

/**
 * Post subscriptions - tracks which users are subscribed to which posts.
 * Users are auto-subscribed when they create, vote on, or comment on a post.
 */
export const postSubscriptions = pgTable(
  'post_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 20 }).notNull(), // 'author' | 'vote' | 'comment' | 'manual'
    muted: boolean('muted').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('post_subscriptions_unique').on(table.postId, table.memberId),
    index('post_subscriptions_member_idx').on(table.memberId),
    index('post_subscriptions_post_idx').on(table.postId),
    // Partial index for active (non-muted) subscriber lookups
    index('post_subscriptions_post_active_idx')
      .on(table.postId)
      .where(sql`muted = false`),
    pgPolicy('post_subscriptions_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: subscriptionsOrgCheck,
      withCheck: subscriptionsOrgCheck,
    }),
  ]
).enableRLS()

/**
 * Notification preferences - per-member email notification settings.
 * Each member has one preferences record per organization.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: text('member_id')
      .notNull()
      .unique()
      .references(() => member.id, { onDelete: 'cascade' }),
    emailStatusChange: boolean('email_status_change').default(true).notNull(),
    emailNewComment: boolean('email_new_comment').default(true).notNull(),
    emailMuted: boolean('email_muted').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('notification_preferences_member_idx').on(table.memberId),
    pgPolicy('notification_preferences_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: preferencesOrgCheck,
      withCheck: preferencesOrgCheck,
    }),
  ]
).enableRLS()

/**
 * Unsubscribe tokens - one-time tokens for email unsubscribe links.
 * Tokens expire after 30 days and are invalidated after use.
 */
export const unsubscribeTokens = pgTable(
  'unsubscribe_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull().unique(),
    memberId: text('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }), // null = global unsubscribe
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
