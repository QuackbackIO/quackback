import { pgTable, text, timestamp, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { member } from './auth'
import { posts } from './posts'
import type { TiptapContent } from '../types'

export const changelogEntries = pgTable(
  'changelog_entries',
  {
    id: typeIdWithDefault('changelog')('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    // Rich content stored as TipTap JSON (optional, for rich text support)
    contentJson: jsonb('content_json').$type<TiptapContent>(),
    // Author tracking (member who created/last edited - only shown in admin views)
    memberId: typeIdColumnNullable('member')('member_id').references(() => member.id, {
      onDelete: 'set null',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('changelog_published_at_idx').on(table.publishedAt),
    index('changelog_member_id_idx').on(table.memberId),
    index('changelog_deleted_at_idx').on(table.deletedAt),
  ]
)

// Junction table for linking changelog entries to shipped posts
export const changelogEntryPosts = pgTable(
  'changelog_entry_posts',
  {
    changelogEntryId: typeIdColumn('changelog')('changelog_entry_id')
      .notNull()
      .references(() => changelogEntries.id, { onDelete: 'cascade' }),
    postId: typeIdColumn('post')('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('changelog_entry_posts_pk').on(table.changelogEntryId, table.postId),
    index('changelog_entry_posts_changelog_id_idx').on(table.changelogEntryId),
    index('changelog_entry_posts_post_id_idx').on(table.postId),
  ]
)

export const changelogEntriesRelations = relations(changelogEntries, ({ one, many }) => ({
  author: one(member, {
    fields: [changelogEntries.memberId],
    references: [member.id],
    relationName: 'changelogAuthor',
  }),
  linkedPosts: many(changelogEntryPosts),
}))

export const changelogEntryPostsRelations = relations(changelogEntryPosts, ({ one }) => ({
  changelogEntry: one(changelogEntries, {
    fields: [changelogEntryPosts.changelogEntryId],
    references: [changelogEntries.id],
  }),
  post: one(posts, {
    fields: [changelogEntryPosts.postId],
    references: [posts.id],
  }),
}))
