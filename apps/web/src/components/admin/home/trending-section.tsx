import { Link } from '@tanstack/react-router'
import { ChevronUpIcon, FireIcon } from '@heroicons/react/20/solid'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
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
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Trending Now</CardTitle>
      </CardHeader>
      <CardContent>
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No trending posts in this period. Once users start voting, trending posts will appear
            here.
          </p>
        ) : (
          <div className="rounded-lg overflow-hidden divide-y divide-border/30 bg-card border border-border/40">
            {posts.map((post, index) => (
              <Link
                key={post.id}
                to="/admin/feedback"
                search={{ post: post.id }}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
                style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
              >
                {/* Vote count box */}
                <div className="flex flex-col items-center w-11 py-1.5 rounded-lg border bg-muted/40 border-border/50 shrink-0">
                  <ChevronUpIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold tabular-nums">{post.voteCount}</span>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {post.statusName && (
                      <StatusBadge name={post.statusName} color={post.statusColor} />
                    )}
                    <span className="font-medium text-sm text-foreground line-clamp-1">
                      {post.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <span>{post.boardName}</span>
                    <span className="text-muted-foreground/40">&middot;</span>
                    <span>{post.votesInPeriod} votes in period</span>
                    {post.votesInPeriod >= hotThreshold && (
                      <FireIcon className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
