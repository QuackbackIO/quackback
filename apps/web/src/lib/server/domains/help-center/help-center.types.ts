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
  slug: string
  name: string
  description: string | null
  isPublic: boolean
  position: number
  createdAt: Date
  updatedAt: Date
}

export interface HelpCenterCategoryWithCount extends HelpCenterCategory {
  articleCount: number
}

// ============================================================================
// Article Types
// ============================================================================

export interface HelpCenterArticle {
  id: HelpCenterArticleId
  categoryId: HelpCenterCategoryId
  slug: string
  title: string
  content: string
  contentJson: TiptapContent | null
  principalId: PrincipalId
  publishedAt: Date | null
  viewCount: number
  helpfulCount: number
  notHelpfulCount: number
  createdAt: Date
  updatedAt: Date
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
