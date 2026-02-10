import { Link } from '@tanstack/react-router'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { ChevronUpIcon, FireIcon } from '@heroicons/react/20/solid'
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

function computeHotThreshold(values: number[]): number {
  if (values.length < 2) return Infinity
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
  return Math.max(median * 2, 1)
}

export function AttentionSection({ data }: { data: AttentionData }) {
  const hasAnything =
    data.unresponded.totalCount > 0 || data.stale.length > 0 || data.negativeHotspots.totalCount > 0

  if (!hasAnything) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircleIcon className="h-5 w-5 text-green-500" />
            All clear — no posts need attention.
          </div>
        </CardContent>
      </Card>
    )
  }

  const unrespondedHotThreshold = computeHotThreshold(
    data.unresponded.items.map((p) => p.voteCount)
  )
  const negativeHotThreshold = computeHotThreshold(
    data.negativeHotspots.items.map((p) => p.voteCount)
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Needs Attention</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Unresponded Posts */}
        {data.unresponded.totalCount > 0 && (
          <div>
            <p className="text-sm mb-2">
              <span className="text-lg font-semibold">{data.unresponded.totalCount}</span>{' '}
              <span className="text-muted-foreground">
                post{data.unresponded.totalCount !== 1 ? 's' : ''} with no team response
              </span>
            </p>
            <div className="rounded-lg overflow-hidden divide-y divide-border/30 border border-border/40">
              {data.unresponded.items.map((post, index) => (
                <Link
                  key={post.id}
                  to="/admin/feedback"
                  search={{ post: post.id }}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
                  style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
                >
                  <div className="flex flex-col items-center w-11 py-1.5 rounded-lg border bg-muted/40 border-border/50 shrink-0">
                    <ChevronUpIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold tabular-nums">{post.voteCount}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-sm text-foreground line-clamp-1">
                      {post.title}
                    </span>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <span>{post.boardName}</span>
                      <span className="text-muted-foreground/40">&middot;</span>
                      <span>{daysAgo(post.createdAt)}d ago</span>
                      {post.voteCount >= unrespondedHotThreshold && (
                        <FireIcon className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                      )}
                    </div>
                  </div>
                </Link>
              ))}
              {data.unresponded.totalCount > data.unresponded.items.length && (
                <Link
                  to="/admin/feedback"
                  search={{ responded: 'unresponded' }}
                  className="block px-3 py-2 text-xs text-primary hover:bg-muted/30 transition-colors"
                >
                  +{data.unresponded.totalCount - data.unresponded.items.length} more →
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Stale Planned Items */}
        {data.stale.length > 0 && (
          <div>
            <p className="text-sm mb-2">
              <span className="text-lg font-semibold">{data.stale.length}</span>{' '}
              <span className="text-muted-foreground">
                stale planned item{data.stale.length !== 1 ? 's' : ''} (no update in 30+ days)
              </span>
            </p>
            <div className="rounded-lg overflow-hidden divide-y divide-border/30 border border-border/40">
              {data.stale.map((post, index) => (
                <Link
                  key={post.id}
                  to="/admin/feedback"
                  search={{ post: post.id }}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
                  style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
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
            <p className="text-sm mb-2">
              <span className="text-lg font-semibold">{data.negativeHotspots.totalCount}</span>{' '}
              <span className="text-muted-foreground">
                high-vote negative-sentiment post{data.negativeHotspots.totalCount !== 1 ? 's' : ''}
              </span>
            </p>
            <div className="rounded-lg overflow-hidden divide-y divide-border/30 border border-border/40">
              {data.negativeHotspots.items.map((post, index) => (
                <Link
                  key={post.id}
                  to="/admin/feedback"
                  search={{ post: post.id }}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
                  style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
                >
                  <div className="flex flex-col items-center w-11 py-1.5 rounded-lg border bg-muted/40 border-border/50 shrink-0">
                    <ChevronUpIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold tabular-nums">{post.voteCount}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {post.statusName && (
                        <StatusBadge name={post.statusName} color={post.statusColor} />
                      )}
                      <span className="font-medium text-sm text-foreground line-clamp-1">
                        {post.title}
                      </span>
                      {post.voteCount >= negativeHotThreshold && (
                        <FireIcon className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                      )}
                    </div>
                  </div>
                </Link>
              ))}
              {data.negativeHotspots.totalCount > data.negativeHotspots.items.length && (
                <Link
                  to="/admin/feedback"
                  search={{ sort: 'votes' }}
                  className="block px-3 py-2 text-xs text-primary hover:bg-muted/30 transition-colors"
                >
                  +{data.negativeHotspots.totalCount - data.negativeHotspots.items.length} more →
                </Link>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
