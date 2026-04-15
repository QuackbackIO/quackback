/**
 * Types for Help Center domain
 */

import type { TiptapContent } from '@/lib/server/db'
import type { HelpCenterCategoryId, HelpCenterArticleId, PrincipalId } from '@quackback/ids'

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
  id: HelpCenterCategoryId
  parentId: HelpCenterCategoryId | null
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
}

// ============================================================================
// Article Types
// ============================================================================

export interface HelpCenterArticle {
  id: HelpCenterArticleId
  categoryId: HelpCenterCategoryId
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
    id: HelpCenterCategoryId
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
