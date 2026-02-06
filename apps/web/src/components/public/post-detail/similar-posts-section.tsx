'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/shared/utils'
import { findSimilarPostsFn, type SimilarPost } from '@/lib/server/functions/public-posts'
import type { PostId } from '@quackback/ids'

function SimilarPostCard({ post }: { post: SimilarPost }) {
  return (
    <Link
      to="/b/$slug/posts/$postId"
      params={{ slug: post.boardSlug, postId: post.id }}
      className="flex items-center gap-3 rounded-lg border border-border/40 bg-card px-4 py-3 transition-colors hover:bg-muted/50"
    >
      <div className="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
        <ChevronUpIcon className="h-3 w-3" />
        <span className="font-medium">{post.voteCount}</span>
      </div>

      <span className="flex-1 text-sm text-foreground/90 line-clamp-1">{post.title}</span>

      {post.status && (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: post.status.color }}
          title={post.status.name}
        />
      )}
    </Link>
  )
}

function SimilarPostsSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3"
        >
          <Skeleton className="h-4 w-8 shrink-0" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
}

interface SimilarPostsSectionProps {
  postTitle: string
  currentPostId: PostId
  className?: string
}

export function SimilarPostsSection({
  postTitle,
  currentPostId,
  className,
}: SimilarPostsSectionProps) {
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['similarPosts', 'detail', postTitle],
    queryFn: async () => {
      const results = await findSimilarPostsFn({ data: { title: postTitle, limit: 5 } })
      return results.filter((p) => p.id !== currentPostId)
    },
    enabled: postTitle.length >= 5,
    staleTime: 5 * 60_000,
  })

  if (!isLoading && posts.length === 0) {
    return null
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2">
        <SparklesIcon className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-medium text-muted-foreground">Related Posts</h3>
      </div>

      {isLoading ? (
        <SimilarPostsSkeleton />
      ) : (
        <div className="space-y-2">
          {posts.map((post) => (
            <SimilarPostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  )
}
