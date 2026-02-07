'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { LinkIcon } from '@heroicons/react/16/solid'
import { cn } from '@/lib/shared/utils'
import { findSimilarPostsFn, type SimilarPost } from '@/lib/server/functions/public-posts'
import type { PostId } from '@quackback/ids'

function SimilarPostRow({ post }: { post: SimilarPost }) {
  return (
    <Link
      to="/b/$slug/posts/$postId"
      params={{ slug: post.boardSlug, postId: post.id }}
      className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/60"
    >
      <div className="flex shrink-0 items-center gap-0.5 tabular-nums text-muted-foreground">
        <ChevronUpIcon className="h-2.5 w-2.5" />
        <span className="font-medium">{post.voteCount}</span>
      </div>

      <span className="flex-1 text-foreground/80 line-clamp-1">{post.title}</span>

      {post.status && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: post.status.color }}
          title={post.status.name}
        />
      )}
    </Link>
  )
}

export function similarPostsQuery(postTitle: string) {
  return {
    queryKey: ['similarPosts', 'detail', postTitle],
    queryFn: () => findSimilarPostsFn({ data: { title: postTitle, limit: 3 } }),
    enabled: postTitle.length >= 5,
    staleTime: 5 * 60_000,
  }
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
  const { data: allPosts = [] } = useQuery(similarPostsQuery(postTitle))
  const posts = allPosts.filter((p) => p.id !== currentPostId)

  if (posts.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        'mt-6 rounded-lg border border-border/30 bg-muted/20 p-3 animate-in fade-in duration-300',
        className
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        <LinkIcon className="h-3 w-3 text-muted-foreground/70" />
        <h3 className="text-xs font-medium text-muted-foreground">Related</h3>
      </div>

      <div className="space-y-0.5">
        {posts.map((post) => (
          <SimilarPostRow key={post.id} post={post} />
        ))}
      </div>
    </div>
  )
}
