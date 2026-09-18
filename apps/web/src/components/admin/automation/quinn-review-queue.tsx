import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { getQuinnReviewQueueFn } from '@/lib/server/functions/assistant-review'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function QuinnReviewQueue({
  kind = 'review',
  days = 7,
  limit = 10,
  title = 'Needs review',
}: {
  kind?: 'review' | 'live'
  days?: 7 | 30
  limit?: number
  title?: string
}) {
  const query = useQuery({
    queryKey: ['assistant', 'reviewQueue', kind, days, limit],
    queryFn: () => getQuinnReviewQueueFn({ data: { kind, days, limit } }),
    refetchInterval: 30000,
  })
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{title}</h2>
      {kind === 'review' && (
        <p className="text-xs text-muted-foreground">
          Pending approvals, recent handoffs and low customer ratings in conversations you can
          access.
        </p>
      )}
      <div className="divide-y rounded-xl border border-border/50 bg-card">
        {query.isPending && (
          <p role="status" className="p-4 text-sm">
            Loading conversations…
          </p>
        )}
        {query.isError && (
          <div role="alert" className="p-4 space-y-2">
            <p>Conversations could not be loaded.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {query.data?.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            {kind === 'live'
              ? 'No active Quinn conversations.'
              : 'No conversations need review in this period.'}
          </p>
        )}
        {query.data?.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium break-words">{row.subject}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Last activity {new Date(row.lastActivityAt).toLocaleString()}
              </p>
            </div>
            <Badge variant="outline">{row.reason}</Badge>
            <Link
              to="/admin/inbox"
              search={{ i: row.id }}
              className="text-sm font-medium text-primary"
            >
              {kind === 'live' ? 'Open' : 'Review'}
            </Link>
          </div>
        ))}
      </div>
      {query.data?.length === limit && (
        <p className="text-xs text-muted-foreground">
          Showing the {limit} most recently active conversations.
        </p>
      )}
    </section>
  )
}
