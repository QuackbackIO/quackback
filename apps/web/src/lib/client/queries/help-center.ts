/**
 * Help Center Queries
 *
 * Query key factories and query options for help center data.
 */

import { queryOptions, infiniteQueryOptions } from '@tanstack/react-query'
import type { HelpCenterArticleId } from '@quackback/ids'
import {
  listCategoriesFn,
  listPublicCategoriesFn,
  listArticlesFn,
  listPublicArticlesFn,
  getArticleFn,
  getPublicArticleBySlugFn,
} from '@/lib/server/functions/help-center'

const STALE_TIME_SHORT = 30 * 1000
const STALE_TIME_MEDIUM = 60 * 1000

export const helpCenterKeys = {
  all: ['help-center'] as const,
  categories: () => [...helpCenterKeys.all, 'categories'] as const,
  publicCategories: () => [...helpCenterKeys.all, 'public-categories'] as const,
  articles: () => [...helpCenterKeys.all, 'articles'] as const,
  articleLists: () => [...helpCenterKeys.articles(), 'list'] as const,
  articleList: (filters: { categoryId?: string; status?: string }) =>
    [...helpCenterKeys.articleLists(), filters] as const,
  articleDetails: () => [...helpCenterKeys.articles(), 'detail'] as const,
  articleDetail: (id: HelpCenterArticleId) => [...helpCenterKeys.articleDetails(), id] as const,
  public: () => [...helpCenterKeys.all, 'public'] as const,
  publicArticleList: (categoryId?: string) =>
    [...helpCenterKeys.public(), 'list', categoryId] as const,
  publicArticleDetail: (slug: string) => [...helpCenterKeys.public(), 'detail', slug] as const,
}

// ============================================================================
// Admin Queries
// ============================================================================

export const helpCenterQueries = {
  categories: () =>
    queryOptions({
      queryKey: helpCenterKeys.categories(),
      queryFn: () => listCategoriesFn({ data: {} }),
      staleTime: STALE_TIME_SHORT,
    }),

  articleList: (params: {
    categoryId?: string
    status?: 'draft' | 'published' | 'all'
    search?: string
  }) =>
    infiniteQueryOptions({
      queryKey: helpCenterKeys.articleList(params),
      queryFn: ({ pageParam }) =>
        listArticlesFn({
          data: {
            categoryId: params.categoryId,
            status: params.status,
            search: params.search,
            cursor: pageParam,
            limit: 20,
          },
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: STALE_TIME_SHORT,
    }),

  articleDetail: (id: HelpCenterArticleId) =>
    queryOptions({
      queryKey: helpCenterKeys.articleDetail(id),
      queryFn: () => getArticleFn({ data: { id } }),
      staleTime: STALE_TIME_MEDIUM,
    }),
}

// ============================================================================
// Public Queries
// ============================================================================

export const publicHelpCenterQueries = {
  categories: () =>
    queryOptions({
      queryKey: helpCenterKeys.publicCategories(),
      queryFn: () => listPublicCategoriesFn({ data: {} }),
      staleTime: STALE_TIME_MEDIUM,
    }),

  articleList: (categoryId?: string) =>
    infiniteQueryOptions({
      queryKey: helpCenterKeys.publicArticleList(categoryId),
      queryFn: ({ pageParam }) =>
        listPublicArticlesFn({
          data: {
            categoryId,
            cursor: pageParam,
            limit: 20,
          },
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      staleTime: STALE_TIME_MEDIUM,
    }),

  articleBySlug: (slug: string) =>
    queryOptions({
      queryKey: helpCenterKeys.publicArticleDetail(slug),
      queryFn: () => getPublicArticleBySlugFn({ data: { slug } }),
      staleTime: STALE_TIME_MEDIUM,
    }),
}
