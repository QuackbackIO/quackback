'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/shared/utils'
import { findSimilarPostsFn, type SimilarPost } from '@/lib/server/functions/public-posts'
import type { PostId } from '@quackback/ids'

interface SimilarPostItemProps {
  post: SimilarPost
}

function SimilarPostItem({ post }: SimilarPostItemProps) {
  return (
    <Link
      to="/b/$slug/posts/$postId"
      params={{ slug: post.boardSlug, postId: post.id }}
      className="flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-md hover:bg-muted/50 transition-colors group"
    >
      {/* Vote count */}
      <div
        className={cn(
          'flex items-center gap-0.5 text-xs tabular-nums shrink-0',
          'text-muted-foreground'
        )}
      >
        <ChevronUpIcon className="h-3 w-3" />
        <span className="font-medium">{post.voteCount}</span>
      </div>

      {/* Title */}
      <span className="flex-1 text-sm text-foreground/90 group-hover:text-foreground line-clamp-1 transition-colors">
        {post.title}
      </span>

      {/* Status indicator dot */}
      {post.status && (
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: post.status.color }}
          title={post.status.name}
        />
      )}
    </Link>
  )
}

function SimilarPostsSkeleton() {
  return (
    <div className="space-y-2 py-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <Skeleton className="h-4 w-8 shrink-0" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
}

interface SimilarPostsSectionProps {
  /** Current post title to find similar posts for */
  postTitle: string
  /** Current post ID to exclude from results */
  currentPostId: PostId
  /** Optional className */
  className?: string
}

export function SimilarPostsSection({
  postTitle,
  currentPostId,
  className,
}: SimilarPostsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['similarPosts', 'detail', postTitle],
    queryFn: async () => {
      const results = await findSimilarPostsFn({ data: { title: postTitle, limit: 5 } })
      // Filter out the current post
      return results.filter((p) => p.id !== currentPostId)
    },
    enabled: postTitle.length >= 5,
    staleTime: 5 * 60_000, // 5 minutes
  })

  // Don't render section at all if no similar posts and not loading
  if (!isLoading && posts.length === 0) {
    return null
  }

  return (
    <div className={cn('border-t border-border/30', className)}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-6 py-3 text-sm hover:bg-muted/30 transition-colors"
      >
        <SparklesIcon className="h-4 w-4 text-amber-500" />
        <span className="font-medium text-muted-foreground">
          {isLoading ? (
            'Finding similar posts...'
          ) : (
            <>
              View {posts.length} similar post{posts.length !== 1 ? 's' : ''}
            </>
          )}
        </span>
        <ChevronRightIcon
          className={cn(
            'h-4 w-4 text-muted-foreground/70 ml-auto transition-transform duration-200',
            isExpanded && 'rotate-90'
          )}
        />
      </button>

      <div
        className="grid transition-all duration-200 ease-out"
        style={{
          gridTemplateRows: isExpanded ? '1fr' : '0fr',
          opacity: isExpanded ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <div className="px-6 pb-4">
            {isLoading ? (
              <SimilarPostsSkeleton />
            ) : (
              <div className="space-y-0.5">
                {posts.map((post, index) => (
                  <div
                    key={post.id}
                    className="animate-in fade-in slide-in-from-bottom-2 duration-200"
                    style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'backwards' }}
                  >
                    <SimilarPostItem post={post} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
