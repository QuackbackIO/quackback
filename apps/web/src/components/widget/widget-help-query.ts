import { queryOptions } from '@tanstack/react-query'
import {
  listPublicArticlesForCategoryFn,
  listPublicCategoriesFn,
} from '@/lib/server/functions/help-center'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { widgetQueryKeys } from '@/lib/client/hooks/use-widget-vote'

const STALE_TIME_MEDIUM = 60 * 1000

/** Identity-aware help collections for the widget (Bearer + sessionVersion). */
export function widgetHelpCategoriesQuery(sessionVersion: number, locale: string) {
  return queryOptions({
    queryKey: widgetQueryKeys.helpCategories.bySession(sessionVersion, locale),
    queryFn: () =>
      listPublicCategoriesFn({
        data: { locale },
        headers: getWidgetAuthHeaders(),
      }),
    staleTime: STALE_TIME_MEDIUM,
  })
}

/** Identity-aware articles in one collection (Bearer + sessionVersion). */
export function widgetHelpCategoryArticlesQuery(
  categoryId: string,
  sessionVersion: number,
  locale: string
) {
  return queryOptions({
    queryKey: widgetQueryKeys.helpCategoryArticles.byCategory(categoryId, sessionVersion, locale),
    queryFn: () =>
      listPublicArticlesForCategoryFn({
        data: { categoryId, locale },
        headers: getWidgetAuthHeaders(),
      }),
    staleTime: STALE_TIME_MEDIUM,
  })
}
