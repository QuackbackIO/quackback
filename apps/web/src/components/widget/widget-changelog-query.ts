import { infiniteQueryOptions } from '@tanstack/react-query'
import { listPublicChangelogsFn } from '@/lib/server/functions/changelog'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { widgetQueryKeys } from '@/lib/client/hooks/use-widget-vote'

const STALE_TIME_MEDIUM = 60 * 1000

/** Identity-aware changelog feed for the widget (Bearer + sessionVersion). */
export function widgetChangelogListQuery(sessionVersion: number) {
  return infiniteQueryOptions({
    queryKey: widgetQueryKeys.changelogList.bySession(sessionVersion),
    queryFn: ({ pageParam }) =>
      listPublicChangelogsFn({
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
