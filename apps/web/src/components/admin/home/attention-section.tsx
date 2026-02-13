import { Link } from '@tanstack/react-router'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import type { PostId } from '@quackback/ids'

interface UnrespondedItem {
  id: PostId
  title: string
  voteCount: number
  createdAt: string
  boardName: string
}

interface StaleItem {
  id: PostId
  title: string
  statusName: string
  updatedAt: string
}

interface NegativeHotspot {
  id: PostId
  title: string
  voteCount: number
  statusName: string | null
  statusColor: string | null
}

interface AttentionData {
  unresponded: { totalCount: number; items: UnrespondedItem[] }
  stale: StaleItem[]
  negativeHotspots: { totalCount: number; items: NegativeHotspot[] }
}

function daysAgo(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

export function AttentionSection({ data }: { data: AttentionData }) {
  const hasAnything =
    data.unresponded.totalCount > 0 || data.stale.length > 0 || data.negativeHotspots.totalCount > 0

  if (!hasAnything) {
    return (
      <Card
        className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
        style={{ animationDelay: '200ms' }}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Needs Attention</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center mb-3">
              <CheckCircleIcon className="h-5 w-5 text-green-500" />
            </div>
            <p className="text-sm font-medium">All caught up!</p>
            <p className="text-xs text-muted-foreground mt-1">
              No posts need your attention right now
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
      style={{ animationDelay: '200ms' }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle className="text-base font-semibold">Needs Attention</CardTitle>
          <div className="flex items-center gap-1.5 text-xs">
            {data.unresponded.totalCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400 px-2 py-0.5 font-medium">
                {data.unresponded.totalCount} unresponded
              </span>
            )}
            {data.stale.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-2 py-0.5 font-medium">
                {data.stale.length} stale
              </span>
            )}
            {data.negativeHotspots.totalCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400 px-2 py-0.5 font-medium">
                {data.negativeHotspots.totalCount} negative
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Unresponded Posts */}
        {data.unresponded.totalCount > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-3">
              Unresponded
            </p>
            <div className="space-y-0.5">
              {data.unresponded.items.map((post) => (
                <Link
                  key={post.id}
                  to="/admin/feedback"
                  search={{ post: post.id }}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <span className="text-xs font-semibold tabular-nums w-6 text-right text-muted-foreground shrink-0">
                    {post.voteCount}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-sm text-foreground line-clamp-1">
                      {post.title}
                    </span>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <span>{post.boardName}</span>
                      <span className="text-muted-foreground/40">&middot;</span>
                      <span>{daysAgo(post.createdAt)}d ago</span>
                    </div>
                  </div>
                </Link>
              ))}
              {data.unresponded.totalCount > data.unresponded.items.length && (
                <Link
                  to="/admin/feedback"
                  search={{ responded: 'unresponded' }}
                  className="inline-flex items-center gap-1 mt-1 ml-3 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  +{data.unresponded.totalCount - data.unresponded.items.length} more &rarr;
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Stale Planned Items */}
        {data.stale.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-3">
              Stale
            </p>
            <div className="space-y-0.5">
              {data.stale.map((post) => (
                <Link
                  key={post.id}
                  to="/admin/feedback"
                  search={{ post: post.id }}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <span className="font-medium text-sm text-foreground line-clamp-1 min-w-0">
                    {post.title}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    <span>{post.statusName}</span>
                    <span className="text-muted-foreground/40">&middot;</span>
                    <span>{daysAgo(post.updatedAt)}d ago</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Negative Hotspots */}
        {data.negativeHotspots.totalCount > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-3">
              Negative sentiment
            </p>
            <div className="space-y-0.5">
              {data.negativeHotspots.items.map((post) => (
                <Link
                  key={post.id}
                  to="/admin/feedback"
                  search={{ post: post.id }}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <span className="text-xs font-semibold tabular-nums w-6 text-right text-muted-foreground shrink-0">
                    {post.voteCount}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {post.statusName && (
                        <StatusBadge name={post.statusName} color={post.statusColor} />
                      )}
                      <span className="font-medium text-sm text-foreground line-clamp-1">
                        {post.title}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
              {data.negativeHotspots.totalCount > data.negativeHotspots.items.length && (
                <Link
                  to="/admin/feedback"
                  search={{ sort: 'votes' }}
                  className="inline-flex items-center gap-1 mt-1 ml-3 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  +{data.negativeHotspots.totalCount - data.negativeHotspots.items.length} more
                  &rarr;
                </Link>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
