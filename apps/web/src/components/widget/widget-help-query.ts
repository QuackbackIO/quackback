import { queryOptions } from '@tanstack/react-query'
import {
  listPublicArticlesForCategoryFn,
  listPublicCategoriesFn,
} from '@/lib/server/functions/help-center'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { INITIAL_SESSION_VERSION, widgetQueryKeys } from '@/lib/client/hooks/use-widget-vote'

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

/**
 * Leave a stored collection once this session's list is in and no longer
 * contains it. Skip the anonymous first paint so identify can still grant
 * a members-only category the visitor arrived on.
 */
export function shouldLeaveUnavailableHelpCategory(
  categoryId: string,
  categories: ReadonlyArray<{ id: string }> | undefined,
  sessionVersion: number
): boolean {
  if (sessionVersion === INITIAL_SESSION_VERSION) return false
  return !!categories && !categories.some((c) => c.id === categoryId)
}
