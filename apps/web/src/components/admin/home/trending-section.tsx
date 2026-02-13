import { Link } from '@tanstack/react-router'
import { FireIcon } from '@heroicons/react/20/solid'
import { ChartBarIcon } from '@heroicons/react/24/outline'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { cn } from '@/lib/shared/utils'
import type { PostId } from '@quackback/ids'

interface TrendingPost {
  id: PostId
  title: string
  voteCount: number
  boardName: string
  sentiment: 'positive' | 'neutral' | 'negative' | null
  statusName: string | null
  statusColor: string | null
  votesInPeriod: number
}

function computeHotThreshold(values: number[]): number {
  if (values.length < 2) return Infinity
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
  return Math.max(median * 2, 1)
}

export function TrendingSection({ posts }: { posts: TrendingPost[] }) {
  const hotThreshold = computeHotThreshold(posts.map((p) => p.votesInPeriod))
  const maxVotes = Math.max(...posts.map((p) => p.votesInPeriod), 1)

  return (
    <Card
      className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
      style={{ animationDelay: '200ms' }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base font-semibold">Trending Now</CardTitle>
          {posts.length > 0 && (
            <span className="text-xs font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5 tabular-nums">
              {posts.length}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <ChartBarIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No trending posts yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Share your feedback board to start collecting votes
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {posts.slice(0, 5).map((post, index) => {
              const barWidth = (post.votesInPeriod / maxVotes) * 100
              const isHot = post.votesInPeriod >= hotThreshold
              return (
                <Link
                  key={post.id}
                  to="/admin/feedback"
                  search={{ post: post.id }}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors group animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
                  style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
                >
                  {/* Rank */}
                  <span
                    className={cn(
                      'text-xs font-bold tabular-nums w-5 text-center shrink-0',
                      index < 3 ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    #{index + 1}
                  </span>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {post.statusName && (
                        <StatusBadge name={post.statusName} color={post.statusColor} />
                      )}
                      <span className="font-medium text-sm text-foreground line-clamp-1">
                        {post.title}
                      </span>
                      {isHot && <FireIcon className="h-3.5 w-3.5 text-orange-500 shrink-0" />}
                    </div>
                    <span className="text-xs text-muted-foreground">{post.boardName}</span>
                  </div>

                  {/* Vote bar + count */}
                  <div className="flex items-center gap-2 shrink-0 w-24">
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/60 transition-all"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold tabular-nums w-6 text-right">
                      {post.votesInPeriod}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
