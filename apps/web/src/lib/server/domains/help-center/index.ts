/**
 * Help Center Domain - Types Only
 *
 * Import service functions directly from './help-center.service' in server-only code.
 */
export type {
  HelpCenterCategory,
  HelpCenterCategoryWithCount,
  HelpCenterArticle,
  HelpCenterArticleWithCategory,
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateArticleInput,
  UpdateArticleInput,
  ListArticlesParams,
  ArticleListResult,
} from './help-center.types'
