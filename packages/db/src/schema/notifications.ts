import { pgTable, text, timestamp, boolean, index, uniqueIndex, varchar } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { posts } from './posts'
import { member, workspace } from './auth'
import { appUser } from './rls'

// Direct workspace_id check for RLS performance
const directWorkspaceCheck = sql`workspace_id = current_setting('app.workspace_id', true)::uuid`

/**
 * Post subscriptions - tracks which users are subscribed to which posts.
 * Users are auto-subscribed when they create, vote on, or comment on a post.
 */
export const postSubscriptions = pgTable(
  'post_subscriptions',
  {
    id: typeIdWithDefault('post_sub')('id').primaryKey(),
    // Denormalized workspace_id for RLS performance
    workspaceId: typeIdColumn('workspace')('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    memberId: typeIdColumn('member')('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 20 }).notNull(), // 'author' | 'vote' | 'comment' | 'manual'
    muted: boolean('muted').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Workspace-prefixed unique constraint for tenant isolation
    uniqueIndex('post_subscriptions_workspace_unique').on(
      table.workspaceId,
      table.postId,
      table.memberId
    ),
    index('post_subscriptions_workspace_id_idx').on(table.workspaceId),
    index('post_subscriptions_member_idx').on(table.memberId),
    index('post_subscriptions_post_idx').on(table.postId),
    // Partial index for active (non-muted) subscriber lookups
    index('post_subscriptions_post_active_idx')
      .on(table.postId)
      .where(sql`muted = false`),
    pgPolicy('post_subscriptions_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: directWorkspaceCheck,
      withCheck: directWorkspaceCheck,
    }),
  ]
).enableRLS()

/**
 * Notification preferences - per-member email notification settings.
 * Each member has one preferences record per workspace.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: typeIdWithDefault('notif_pref')('id').primaryKey(),
    // Denormalized workspace_id for RLS performance
    workspaceId: typeIdColumn('workspace')('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
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
  (table) => [
    index('notification_preferences_workspace_id_idx').on(table.workspaceId),
    index('notification_preferences_member_idx').on(table.memberId),
    pgPolicy('notification_preferences_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: directWorkspaceCheck,
      withCheck: directWorkspaceCheck,
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
    id: typeIdWithDefault('unsub_token')('id').primaryKey(),
    // Denormalized workspace_id for RLS performance
    workspaceId: typeIdColumn('workspace')('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
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
    index('unsubscribe_tokens_workspace_id_idx').on(table.workspaceId),
    index('unsubscribe_tokens_token_idx').on(table.token),
    index('unsubscribe_tokens_member_idx').on(table.memberId),
    pgPolicy('unsubscribe_tokens_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: directWorkspaceCheck,
      withCheck: directWorkspaceCheck,
    }),
  ]
).enableRLS()

// Relations
export const postSubscriptionsRelations = relations(postSubscriptions, ({ one }) => ({
  workspace: one(workspace, {
    fields: [postSubscriptions.workspaceId],
    references: [workspace.id],
  }),
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
  workspace: one(workspace, {
    fields: [notificationPreferences.workspaceId],
    references: [workspace.id],
  }),
  member: one(member, {
    fields: [notificationPreferences.memberId],
    references: [member.id],
  }),
}))

export const unsubscribeTokensRelations = relations(unsubscribeTokens, ({ one }) => ({
  workspace: one(workspace, {
    fields: [unsubscribeTokens.workspaceId],
    references: [workspace.id],
  }),
  member: one(member, {
    fields: [unsubscribeTokens.memberId],
    references: [member.id],
  }),
  post: one(posts, {
    fields: [unsubscribeTokens.postId],
    references: [posts.id],
  }),
}))
