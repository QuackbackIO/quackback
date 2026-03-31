import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
  jsonb,
  customType,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import type { TiptapContent } from '../types'

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

const vector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(1536)'
  },
})

// ============================================
// Help Center Categories
// ============================================

export const helpCenterCategories = pgTable(
  'kb_categories',
  {
    id: typeIdWithDefault('helpcenter_category')('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').default(true).notNull(),
    position: integer('position').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('kb_categories_slug_idx').on(table.slug),
    index('kb_categories_position_idx').on(table.position),
    index('kb_categories_deleted_at_idx').on(table.deletedAt),
  ]
)

// ============================================
// Help Center Articles
// ============================================

export const helpCenterArticles = pgTable(
  'kb_articles',
  {
    id: typeIdWithDefault('helpcenter_article')('id').primaryKey(),
    categoryId: typeIdColumn('helpcenter_category')('category_id')
      .notNull()
      .references(() => helpCenterCategories.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    contentJson: jsonb('content_json').$type<TiptapContent>(),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'restrict' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    viewCount: integer('view_count').default(0).notNull(),
    helpfulCount: integer('helpful_count').default(0).notNull(),
    notHelpfulCount: integer('not_helpful_count').default(0).notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(content, '')), 'B')`
    ),
    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    embeddingUpdatedAt: timestamp('embedding_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('kb_articles_slug_idx').on(table.slug),
    index('kb_articles_category_id_idx').on(table.categoryId),
    index('kb_articles_principal_id_idx').on(table.principalId),
    index('kb_articles_published_at_idx').on(table.publishedAt),
    index('kb_articles_deleted_at_idx').on(table.deletedAt),
    index('kb_articles_category_published_idx').on(table.categoryId, table.publishedAt),
    index('kb_articles_search_vector_idx').using('gin', table.searchVector),
  ]
)

// ============================================
// Article Feedback (helpful/not helpful)
// ============================================

export const helpCenterArticleFeedback = pgTable(
  'kb_article_feedback',
  {
    id: typeIdWithDefault('helpcenter_feedback')('id').primaryKey(),
    articleId: typeIdColumn('helpcenter_article')('article_id')
      .notNull()
      .references(() => helpCenterArticles.id, { onDelete: 'cascade' }),
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    helpful: boolean('helpful').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('kb_article_feedback_article_id_idx').on(table.articleId),
    uniqueIndex('kb_article_feedback_unique_idx').on(table.articleId, table.principalId),
  ]
)

// ============================================
// Relations
// ============================================

export const helpCenterCategoriesRelations = relations(helpCenterCategories, ({ many }) => ({
  articles: many(helpCenterArticles),
}))

export const helpCenterArticlesRelations = relations(helpCenterArticles, ({ one, many }) => ({
  category: one(helpCenterCategories, {
    fields: [helpCenterArticles.categoryId],
    references: [helpCenterCategories.id],
  }),
  author: one(principal, {
    fields: [helpCenterArticles.principalId],
    references: [principal.id],
    relationName: 'helpCenterArticleAuthor',
  }),
  feedback: many(helpCenterArticleFeedback),
}))

export const helpCenterArticleFeedbackRelations = relations(
  helpCenterArticleFeedback,
  ({ one }) => ({
    article: one(helpCenterArticles, {
      fields: [helpCenterArticleFeedback.articleId],
      references: [helpCenterArticles.id],
    }),
    principal: one(principal, {
      fields: [helpCenterArticleFeedback.principalId],
      references: [principal.id],
      relationName: 'helpCenterFeedbackPrincipal',
    }),
  })
)
