/**
 * Types for Help Center domain
 */

import type { TiptapContent } from '@/lib/server/db'
import type {
  KbCategoryId,
  KbArticleId,
  PrincipalId,
  KbArticleTranslationId,
  KbCategoryTranslationId,
} from '@quackback/ids'

// Re-export input types from shared schemas (single source of truth)
export type {
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateArticleInput,
  UpdateArticleInput,
  ListArticlesParams,
} from '@/lib/shared/schemas/help-center'

// ============================================================================
// Category Types
// ============================================================================

export interface HelpCenterCategory {
  id: KbCategoryId
  parentId: KbCategoryId | null
  slug: string
  name: string
  description: string | null
  icon: string | null
  isPublic: boolean
  position: number
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date | null
}

export interface HelpCenterCategoryWithCount extends HelpCenterCategory {
  /** Total non-deleted articles in this category (drafts + published). */
  articleCount: number
  /** Published articles in this category (excludes drafts and scheduled). */
  publishedArticleCount: number
  /** articleCount plus the same for every descendant in the tree. */
  recursiveArticleCount: number
  /** publishedArticleCount plus the same for every descendant in the tree. */
  recursivePublishedArticleCount: number
}

// ============================================================================
// Article Types
// ============================================================================

export interface HelpCenterArticle {
  id: KbArticleId
  categoryId: KbCategoryId
  slug: string
  title: string
  description: string | null
  position: number | null
  content: string
  contentJson: TiptapContent | null
  principalId: PrincipalId
  publishedAt: Date | null
  viewCount: number
  helpfulCount: number
  notHelpfulCount: number
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date | null
}

export interface HelpCenterArticleWithCategory extends HelpCenterArticle {
  category: {
    id: KbCategoryId
    slug: string
    name: string
  }
  author: {
    id: PrincipalId
    name: string
    avatarUrl: string | null
  } | null
}

// ============================================================================
// List/Search Types
// ============================================================================

export interface ArticleListResult {
  items: HelpCenterArticleWithCategory[]
  nextCursor: string | null
  hasMore: boolean
}

// ============================================================================
// Translation Types (domains/languages §2)
// ============================================================================

/** Distinct from the DB `status` column: 'untranslated' means no row exists at all. */
export type TranslationStatus = 'draft' | 'published' | 'untranslated'

export interface HelpCenterArticleTranslation {
  id: KbArticleTranslationId
  articleId: KbArticleId
  locale: string
  title: string
  description: string | null
  content: string
  contentJson: TiptapContent | null
  status: 'draft' | 'published'
  createdAt: Date
  updatedAt: Date
}

export interface HelpCenterCategoryTranslation {
  id: KbCategoryTranslationId
  categoryId: KbCategoryId
  locale: string
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}

/** One row per enabled additional locale, for the admin editor's status pills. */
export interface ArticleTranslationStatusEntry {
  locale: string
  status: TranslationStatus
  updatedAt: Date | null
}

export interface CategoryTranslationStatusEntry {
  locale: string
  /** Categories have no draft/published split -- a non-empty name IS "translated". */
  status: 'translated' | 'untranslated'
  updatedAt: Date | null
}
