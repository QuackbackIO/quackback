/**
 * Zod Schemas for Help Center Operations
 *
 * Shared validation schemas used by both client and server.
 */

import { z } from 'zod'
import { tiptapContentSchema } from './posts'
import { SUPPORTED_LOCALES } from '../i18n'

// ============================================================================
// Category Schemas
// ============================================================================

export const listCategoriesSchema = z.object({
  showDeleted: z.boolean().optional(),
})

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  slug: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  isPublic: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  parentId: z.string().nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
})

export const updateCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  slug: z.string().max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  isPublic: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  parentId: z.string().nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
})

export const getCategorySchema = z.object({
  id: z.string().min(1),
})

export const deleteCategorySchema = z.object({
  id: z.string().min(1),
})

// ============================================================================
// Article Schemas
// ============================================================================

export const createArticleSchema = z.object({
  categoryId: z.string().min(1),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required'),
  contentJson: tiptapContentSchema.nullable().optional(),
  slug: z.string().max(200).optional(),
  position: z.number().int().optional(),
  description: z.string().max(300).optional(),
})

export const updateArticleSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  contentJson: tiptapContentSchema.nullable().optional(),
  slug: z.string().max(200).optional(),
  position: z.number().int().optional(),
  description: z.string().max(300).optional(),
})

export const getArticleSchema = z.object({
  id: z.string().min(1),
})

export const deleteArticleSchema = z.object({
  id: z.string().min(1),
})

export const listArticlesSchema = z.object({
  categoryId: z.string().optional(),
  status: z.enum(['draft', 'published', 'all']).optional(),
  search: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
  showDeleted: z.boolean().optional(),
  sort: z.enum(['newest', 'oldest']).optional(),
})

export const listPublicArticlesSchema = z.object({
  categoryId: z.string().optional(),
  search: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
})

export const publishArticleSchema = z.object({
  id: z.string().min(1),
})

export const articleFeedbackSchema = z.object({
  articleId: z.string().min(1),
  helpful: z.boolean(),
})

export const getCategoryBySlugSchema = z.object({
  slug: z.string().min(1),
  /** Omitted/undefined = the default locale (domains/languages §2). */
  locale: z.string().optional(),
})

export const getArticleBySlugSchema = z.object({
  slug: z.string().min(1),
  locale: z.string().optional(),
})

export const unpublishArticleSchema = z.object({
  id: z.string().min(1),
})

export const restoreCategorySchema = z.object({
  id: z.string().min(1),
})

export const restoreArticleSchema = z.object({
  id: z.string().min(1),
})

// ============================================================================
// Help Center Config Schemas
// ============================================================================

export const updateHelpCenterConfigSchema = z.object({
  enabled: z.boolean().optional(),
  homepageTitle: z.string().min(1).max(200).optional(),
  homepageDescription: z.string().max(500).optional(),
})

export const updateHelpCenterSeoSchema = z.object({
  metaDescription: z.string().max(500).optional(),
  sitemapEnabled: z.boolean().optional(),
  structuredDataEnabled: z.boolean().optional(),
  indexable: z.boolean().optional(),
})

// ============================================================================
// Domain Schemas (domains/languages §1)
// ============================================================================

/** Setting the domain to null clears it (and any verification). */
export const updateHelpCenterDomainSchema = z.object({
  domain: z.string().max(253).nullable(),
})

// ============================================================================
// Locale Schemas (domains/languages §2)
// ============================================================================

const supportedLocaleSchema = z.enum(SUPPORTED_LOCALES)

export const helpCenterLocaleChromeSchema = z.object({
  homepageTitle: z.string().max(200),
  homepageDescription: z.string().max(500),
  searchPlaceholder: z.string().max(200),
})

/** Enabling requires the full chrome bundle -- a non-empty title is enforced server-side. */
export const enableHelpCenterLocaleSchema = z.object({
  locale: supportedLocaleSchema,
  chrome: helpCenterLocaleChromeSchema,
})

export const disableHelpCenterLocaleSchema = z.object({
  locale: supportedLocaleSchema,
})

export const updateHelpCenterLocaleChromeSchema = z.object({
  locale: supportedLocaleSchema,
  chrome: helpCenterLocaleChromeSchema.partial(),
})

// ============================================================================
// Translation Schemas (domains/languages §2)
// ============================================================================

export const getArticleTranslationSchema = z.object({
  articleId: z.string().min(1),
  locale: supportedLocaleSchema,
})

export const upsertArticleTranslationSchema = z.object({
  articleId: z.string().min(1),
  locale: supportedLocaleSchema,
  title: z.string().max(200),
  description: z.string().max(300).optional(),
  content: z.string(),
  contentJson: tiptapContentSchema.nullable().optional(),
})

export const setArticleTranslationStatusSchema = z.object({
  articleId: z.string().min(1),
  locale: supportedLocaleSchema,
  status: z.enum(['draft', 'published']),
})

export const deleteArticleTranslationSchema = z.object({
  articleId: z.string().min(1),
  locale: supportedLocaleSchema,
})

export const getCategoryTranslationSchema = z.object({
  categoryId: z.string().min(1),
  locale: supportedLocaleSchema,
})

export const upsertCategoryTranslationSchema = z.object({
  categoryId: z.string().min(1),
  locale: supportedLocaleSchema,
  name: z.string().max(200),
  description: z.string().max(2000).optional(),
})

export const deleteCategoryTranslationSchema = z.object({
  categoryId: z.string().min(1),
  locale: supportedLocaleSchema,
})

// ============================================================================
// Redirect Rule Schemas (domains/languages §2)
// ============================================================================

const redirectRulePath = z
  .string()
  .min(1, 'Path is required')
  .max(500)
  .refine((v) => v.startsWith('/'), 'Path must start with /')

export const createRedirectRuleSchema = z.object({
  path: redirectRulePath,
  targetType: z.enum(['article', 'category']),
  targetId: z.string().min(1),
})

export const deleteRedirectRuleSchema = z.object({
  id: z.string().min(1),
})

// ============================================================================
// Inferred Types
// ============================================================================

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = Omit<z.infer<typeof updateCategorySchema>, 'id'>
export type UpdateCategoryPayload = z.infer<typeof updateCategorySchema>
export type CreateArticleInput = z.infer<typeof createArticleSchema>
export type UpdateArticleInput = Omit<z.infer<typeof updateArticleSchema>, 'id'>
export type UpdateArticlePayload = z.infer<typeof updateArticleSchema>
export type ListArticlesParams = z.infer<typeof listArticlesSchema>
