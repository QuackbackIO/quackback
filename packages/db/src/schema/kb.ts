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
  type AnyPgColumn,
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
// Locale -> Postgres text-search config (domains/languages §2)
// ============================================

/**
 * Locale -> Postgres regconfig for per-locale keyword FTS. Stock Postgres
 * ships no CJK tokenizer, so zh-cn/zh-tw fall back to 'simple' (whitespace/
 * punctuation tokenizing, no stemming) rather than a language-specific
 * config. This is the single source of truth: {@link localeRegconfigCaseSql}
 * generates the migration's GENERATED column expression from it, and the
 * help-center search service imports it to build matching tsquery calls.
 */
export const LOCALE_TO_REGCONFIG: Record<string, string> = {
  en: 'english',
  de: 'german',
  fr: 'french',
  es: 'spanish',
  ar: 'arabic',
  ru: 'russian',
  'pt-br': 'portuguese',
  'zh-cn': 'simple',
  'zh-tw': 'simple',
}

export function regconfigForLocale(locale: string): string {
  return LOCALE_TO_REGCONFIG[locale] ?? 'english'
}

/**
 * SQL `CASE <localeExpr> WHEN ... THEN '<regconfig>' ... ELSE 'english' END::regconfig`,
 * generated from {@link LOCALE_TO_REGCONFIG} so the generated tsvector column
 * and the raw migration SQL can never drift apart. Safe to inline directly
 * (no interpolated user input -- every value comes from the static map).
 */
export function localeRegconfigCaseSql(localeExpr: string): string {
  const whens = Object.entries(LOCALE_TO_REGCONFIG)
    .filter(([, cfg]) => cfg !== 'english')
    .map(([locale, cfg]) => `WHEN '${locale}' THEN '${cfg}'`)
    .join(' ')
  return `CASE ${localeExpr} ${whens} ELSE 'english' END::regconfig`
}

// ============================================
// Help Center Categories
// ============================================

export const helpCenterCategories = pgTable(
  'kb_categories',
  {
    id: typeIdWithDefault('kb_category')('id').primaryKey(),
    parentId: typeIdColumnNullable('kb_category')('parent_id').references(
      (): AnyPgColumn => helpCenterCategories.id,
      { onDelete: 'set null' }
    ),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'),
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
    index('kb_categories_parent_id_idx').on(table.parentId),
  ]
)

// ============================================
// Help Center Articles
// ============================================

export const helpCenterArticles = pgTable(
  'kb_articles',
  {
    id: typeIdWithDefault('kb_article')('id').primaryKey(),
    categoryId: typeIdColumn('kb_category')('category_id')
      .notNull()
      .references(() => helpCenterCategories.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    position: integer('position'),
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
    index('kb_articles_category_position_idx').on(table.categoryId, table.position),
    index('kb_articles_search_vector_idx').using('gin', table.searchVector),
  ]
)

// ============================================
// Article Feedback (helpful/not helpful)
// ============================================

export const helpCenterArticleFeedback = pgTable(
  'kb_article_feedback',
  {
    id: typeIdWithDefault('kb_article_feedback')('id').primaryKey(),
    articleId: typeIdColumn('kb_article')('article_id')
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
// Redirect Rules (domains/languages §2)
// ============================================

/**
 * Admin-defined path -> published article|category 301s for the /hc site.
 * `targetType`/`targetId` is a polymorphic reference with no FK constraint
 * (a single FK can't span kb_articles and kb_categories) -- the owning
 * article/category service deletes orphaned rules explicitly on hard delete.
 */
export const helpCenterRedirectRules = pgTable(
  'hc_redirect_rules',
  {
    id: typeIdWithDefault('hc_redirect_rule')('id').primaryKey(),
    path: text('path').notNull(),
    targetType: text('target_type').$type<'article' | 'category'>().notNull(),
    targetId: text('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('hc_redirect_rules_path_idx').on(table.path),
    index('hc_redirect_rules_target_idx').on(table.targetType, table.targetId),
  ]
)

// ============================================
// Translations (domains/languages §2)
// ============================================

/**
 * Per-article translation variants (not chrome-only): default locale content
 * lives on kb_articles itself; every additional locale is a row here.
 * `status` is independent of the base article's publishedAt -- a translation
 * can be a draft while the base article is published, or vice versa. Only
 * `published` translations are visible on the public /hc/{locale} site.
 */
export const helpCenterArticleTranslations = pgTable(
  'kb_article_translations',
  {
    id: typeIdWithDefault('kb_article_translation')('id').primaryKey(),
    articleId: typeIdColumn('kb_article')('article_id')
      .notNull()
      .references(() => helpCenterArticles.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    title: text('title').notNull().default(''),
    description: text('description'),
    content: text('content').notNull().default(''),
    contentJson: jsonb('content_json').$type<TiptapContent>(),
    status: text('status').$type<'draft' | 'published'>().notNull().default('draft'),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector(${sql.raw(localeRegconfigCaseSql('locale'))}, coalesce(title, '')), 'A') || setweight(to_tsvector(${sql.raw(localeRegconfigCaseSql('locale'))}, coalesce(content, '')), 'B')`
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('kb_article_translations_unique_idx').on(table.articleId, table.locale),
    index('kb_article_translations_locale_idx').on(table.locale),
    index('kb_article_translations_search_vector_idx').using('gin', table.searchVector),
  ]
)

/**
 * Per-category translation variants. No `status` column -- a category's
 * presence in a locale is purely "does a translation row with a non-empty
 * name exist", per the homepage visibility gate (domains/languages §1).
 */
export const helpCenterCategoryTranslations = pgTable(
  'kb_category_translations',
  {
    id: typeIdWithDefault('kb_category_translation')('id').primaryKey(),
    categoryId: typeIdColumn('kb_category')('category_id')
      .notNull()
      .references(() => helpCenterCategories.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    name: text('name').notNull().default(''),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('kb_category_translations_unique_idx').on(table.categoryId, table.locale),
    index('kb_category_translations_locale_idx').on(table.locale),
  ]
)

// ============================================
// Relations
// ============================================

export const helpCenterCategoriesRelations = relations(helpCenterCategories, ({ one, many }) => ({
  parent: one(helpCenterCategories, {
    fields: [helpCenterCategories.parentId],
    references: [helpCenterCategories.id],
    relationName: 'categoryParent',
  }),
  children: many(helpCenterCategories, { relationName: 'categoryParent' }),
  articles: many(helpCenterArticles),
  translations: many(helpCenterCategoryTranslations),
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
  translations: many(helpCenterArticleTranslations),
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

export const helpCenterArticleTranslationsRelations = relations(
  helpCenterArticleTranslations,
  ({ one }) => ({
    article: one(helpCenterArticles, {
      fields: [helpCenterArticleTranslations.articleId],
      references: [helpCenterArticles.id],
    }),
  })
)

export const helpCenterCategoryTranslationsRelations = relations(
  helpCenterCategoryTranslations,
  ({ one }) => ({
    category: one(helpCenterCategories, {
      fields: [helpCenterCategoryTranslations.categoryId],
      references: [helpCenterCategories.id],
    }),
  })
)
