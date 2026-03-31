import { Link } from '@tanstack/react-router'

interface TopPostsProps {
  posts: Array<{
    rank: number
    postId: string
    title: string
    voteCount: number
    commentCount: number
    boardName: string | null
    statusName: string | null
  }>
}

export function AnalyticsTopPosts({ posts }: TopPostsProps) {
  if (posts.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No posts in this period
      </div>
    )
  }

  const maxVotes = Math.max(...posts.map((p) => p.voteCount), 1)

  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-medium tracking-wider uppercase text-muted-foreground">
        <span>Post</span>
        <span>Votes</span>
      </div>
      <div className="flex flex-col">
        {posts.map((post) => {
          const pct = (post.voteCount / maxVotes) * 100
          return (
            <div key={post.postId} className="relative flex items-center overflow-hidden py-2">
              <div
                className="absolute inset-y-0 left-0 rounded-sm bg-foreground/[0.06]"
                style={{ width: `${pct}%` }}
              />
              <Link
                to="/admin/feedback"
                search={{ post: post.postId }}
                className="relative flex-1 truncate px-1 text-sm hover:text-primary transition-colors"
              >
                {post.title}
              </Link>
              <span className="relative ml-4 shrink-0 tabular-nums text-sm text-muted-foreground">
                {post.voteCount}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
