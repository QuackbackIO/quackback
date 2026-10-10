import { infiniteQueryOptions } from '@tanstack/react-query'
import { widgetListPublicChangelogsFn } from '@/lib/server/functions/widget/changelog'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { INITIAL_SESSION_VERSION, widgetQueryKeys } from '@/lib/client/hooks/use-widget-vote'

const STALE_TIME_MEDIUM = 60 * 1000

/** Identity-aware changelog feed for the widget (Bearer + sessionVersion). */
export function widgetChangelogListQuery(sessionVersion: number) {
  return infiniteQueryOptions({
    queryKey: widgetQueryKeys.changelogList.bySession(sessionVersion),
    queryFn: ({ pageParam }) =>
      widgetListPublicChangelogsFn({
        data: {
          cursor: pageParam,
          limit: 10,
        },
        headers: getWidgetAuthHeaders(),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: STALE_TIME_MEDIUM,
  })
}

/**
 * Drop a changelog category the current session's visible entries no longer
 * contain. Wait until the feed is in and lookahead has finished, and skip
 * the anonymous first paint so identify can still grant a gated segment.
 */
export function shouldClearUnavailableChangelogCategory(
  activeCategoryId: string | null,
  categoriesInUse: ReadonlyArray<{ id: string }>,
  options: { sessionVersion: number; listReady: boolean; stillLooking: boolean }
): boolean {
  if (options.sessionVersion === INITIAL_SESSION_VERSION) return false
  if (!options.listReady || options.stillLooking) return false
  if (!activeCategoryId) return false
  return !categoriesInUse.some((c) => c.id === activeCategoryId)
}
