import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { UsersIcon } from '@heroicons/react/24/outline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'
import { TimeAgo } from '@/components/ui/time-ago'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { statusSubscriberQueries } from '@/lib/client/queries/status'

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-xl border border-border/50 bg-card px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

export function StatusSubscribersView() {
  const countsQuery = useQuery(statusSubscriberQueries.counts())
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    statusSubscriberQueries.list()
  )

  const loadMoreRef = useInfiniteScroll({
    hasMore: !!hasNextPage,
    isFetching: isLoading || isFetchingNextPage,
    onLoadMore: fetchNextPage,
    rootMargin: '0px',
    threshold: 0.1,
  })

  const items = data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="max-w-3xl mx-auto w-full p-4 space-y-4">
      <div className="flex gap-3">
        <CountTile label="Total subscribers" value={countsQuery.data?.total ?? 0} />
        <CountTile label="Active" value={countsQuery.data?.active ?? 0} />
        <CountTile label="Unsubscribed" value={countsQuery.data?.unsubscribed ?? 0} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No subscribers yet" className="h-48" />
      ) : (
        <div className="rounded-xl overflow-hidden border border-border/50 bg-card divide-y divide-border/50">
          {items.map((sub) => (
            <div key={sub.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {sub.displayName ?? sub.email ?? 'Unknown'}
                </div>
                {sub.email && sub.displayName && (
                  <div className="text-xs text-muted-foreground truncate">{sub.email}</div>
                )}
              </div>
              <Badge variant="outline" className="capitalize">
                {sub.scope === 'components'
                  ? `${sub.componentIds.length} components`
                  : 'Whole page'}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {sub.source.replace('_', ' ')}
              </Badge>
              <div className="text-xs text-muted-foreground w-32 text-right shrink-0">
                {sub.unsubscribedAt ? (
                  <span>
                    Unsubscribed <TimeAgo date={sub.unsubscribedAt} />
                  </span>
                ) : (
                  <span>
                    Subscribed <TimeAgo date={sub.createdAt} />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasNextPage && (
        <div ref={loadMoreRef} className="flex justify-center py-2">
          {isFetchingNextPage ? (
            <Spinner />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchNextPage()}
              className="text-muted-foreground"
            >
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
