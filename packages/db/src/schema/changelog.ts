import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  jsonb,
  boolean,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { posts } from './posts'
import { segments } from './segments'
import type { TiptapContent } from '../types'

// ============================================
// Changelog Visibility Configuration Types
// ============================================

/**
 * Per-segment (or org-level) changelog category/product visibility config.
 * When restrictCategories is false, all categories are visible.
 * When true, only entries whose categoryId is in allowedCategoryIds are visible
 * (entries with no category are always visible regardless).
 */
export interface ChangelogVisibilityConfig {
  restrictCategories?: boolean
  allowedCategoryIds?: string[]
  restrictProducts?: boolean
  allowedProductIds?: string[]
}

export const changelogCategories = pgTable(
  'changelog_categories',
  {
    id: typeIdWithDefault('changelog_cat')('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('changelog_categories_slug_idx').on(table.slug)]
)

export const changelogProducts = pgTable(
  'changelog_products',
  {
    id: typeIdWithDefault('changelog_prod')('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('changelog_products_slug_idx').on(table.slug)]
)

export const changelogEntries = pgTable(
  'changelog_entries',
  {
    id: typeIdWithDefault('changelog')('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    // Rich content stored as TipTap JSON (optional, for rich text support)
    contentJson: jsonb('content_json').$type<TiptapContent>(),
    // Author tracking (principal who created/last edited - only shown in admin views)
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    categoryId: typeIdColumnNullable('changelog_cat')('category_id').references(
      () => changelogCategories.id,
      { onDelete: 'set null' }
    ),
    productId: typeIdColumnNullable('changelog_prod')('product_id').references(
      () => changelogProducts.id,
      { onDelete: 'set null' }
    ),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete support
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // View count for analytics (incremented on public/widget page load)
    viewCount: integer('view_count').default(0).notNull(),
  },
  (table) => [
    index('changelog_published_at_idx').on(table.publishedAt),
    index('changelog_principal_id_idx').on(table.principalId),
    index('changelog_category_id_idx').on(table.categoryId),
    index('changelog_product_id_idx').on(table.productId),
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
  author: one(principal, {
    fields: [changelogEntries.principalId],
    references: [principal.id],
    relationName: 'changelogAuthor',
  }),
  category: one(changelogCategories, {
    fields: [changelogEntries.categoryId],
    references: [changelogCategories.id],
  }),
  product: one(changelogProducts, {
    fields: [changelogEntries.productId],
    references: [changelogProducts.id],
  }),
  linkedPosts: many(changelogEntryPosts),
}))

export const changelogCategoriesRelations = relations(changelogCategories, ({ many }) => ({
  entries: many(changelogEntries),
}))

export const changelogProductsRelations = relations(changelogProducts, ({ many }) => ({
  entries: many(changelogEntries),
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

// ============================================
// Changelog Visibility (category/product access control)
// ============================================

/**
 * Per-segment changelog category/product visibility overrides.
 *
 * When restrictCategories is true, portal users in this segment only see
 * changelog entries whose categoryId is in allowedCategoryIds (or has no
 * category). When restrictCategories is false (default) all categories are
 * visible for users in this segment.
 *
 * Effective config for a user is the UNION across their segments + org
 * defaults: if any config is unrestricted the user sees everything.
 */
export const changelogSegmentVisibility = pgTable(
  'changelog_segment_visibility',
  {
    id: typeIdWithDefault('clseg_vis')('id').primaryKey(),
    segmentId: typeIdColumn('segment')('segment_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' })
      .unique(),
    /** When true, limit visible entries to allowedCategoryIds (+ null category) */
    restrictCategories: boolean('restrict_categories').notNull().default(false),
    /** Category IDs allowed when restrictCategories=true */
    allowedCategoryIds: jsonb('allowed_category_ids').$type<string[]>().notNull().default([]),
    /** When true, limit visible entries to allowedProductIds (+ null product) */
    restrictProducts: boolean('restrict_products').notNull().default(false),
    /** Product IDs allowed when restrictProducts=true */
    allowedProductIds: jsonb('allowed_product_ids').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('changelog_segment_visibility_segment_id_idx').on(table.segmentId)]
)

export const changelogSegmentVisibilityRelations = relations(
  changelogSegmentVisibility,
  ({ one }) => ({
    segment: one(segments, {
      fields: [changelogSegmentVisibility.segmentId],
      references: [segments.id],
    }),
  })
)
