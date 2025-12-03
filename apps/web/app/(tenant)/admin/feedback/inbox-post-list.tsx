'use client'

import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { InboxPostCard } from './inbox-post-card'
import { InboxEmptyState } from './inbox-empty-state'
import type { PostListItem, PostStatusEntity } from '@quackback/db'
import type { InboxFilters } from './use-inbox-filters'

interface InboxPostListProps {
  posts: PostListItem[]
  statuses: PostStatusEntity[]
  total: number
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  selectedPostId: string | null
  onSelectPost: (id: string | null) => void
  onLoadMore: () => void
  sort: InboxFilters['sort']
  onSortChange: (sort: InboxFilters['sort']) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
}

function PostListSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-8 w-8 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function InboxPostList({
  posts,
  statuses,
  total,
  hasMore,
  isLoading,
  isLoadingMore,
  selectedPostId,
  onSelectPost,
  onLoadMore,
  sort,
  onSortChange,
  hasActiveFilters,
  onClearFilters,
}: InboxPostListProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null)

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isLoading && !isLoadingMore) {
          onLoadMore()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [hasMore, isLoading, isLoadingMore, onLoadMore])

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          ;(e.target as HTMLElement).blur()
        }
        return
      }

      const currentIndex = selectedPostId ? posts.findIndex((p) => p.id === selectedPostId) : -1

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          if (posts.length > 0) {
            const nextIndex = Math.min(currentIndex + 1, posts.length - 1)
            onSelectPost(posts[nextIndex]?.id ?? null)
          }
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          if (posts.length > 0 && currentIndex > 0) {
            const prevIndex = Math.max(currentIndex - 1, 0)
            onSelectPost(posts[prevIndex]?.id ?? null)
          }
          break
        case 'Escape':
          onSelectPost(null)
          break
        case '/':
          e.preventDefault()
          document.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [posts, selectedPostId, onSelectPost])

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b bg-card sticky top-0 z-10">
          <span className="text-xs text-muted-foreground">Loading...</span>
        </div>
        <PostListSkeleton />
      </div>
    )
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b bg-card sticky top-0 z-10">
          <span className="text-xs text-muted-foreground">0 posts</span>
        </div>
        <InboxEmptyState
          type={hasActiveFilters ? 'no-results' : 'no-posts'}
          onClearFilters={hasActiveFilters ? onClearFilters : undefined}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-card sticky top-0 z-10">
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? 'post' : 'posts'}
        </span>
        <Select
          value={sort || 'newest'}
          onValueChange={(value) => onSortChange(value as 'newest' | 'oldest' | 'votes')}
        >
          <SelectTrigger className="h-7 w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="votes">Top Votes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Post List */}
      <div className="flex-1 p-4 space-y-3">
        {posts.map((post) => (
          <InboxPostCard
            key={post.id}
            post={post}
            statuses={statuses}
            isSelected={post.id === selectedPostId}
            onClick={() => onSelectPost(post.id)}
          />
        ))}

        {/* Load more trigger */}
        {hasMore && (
          <div ref={loadMoreRef} className="py-4 flex justify-center">
            {isLoadingMore ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <Button variant="ghost" onClick={onLoadMore}>
                Load more
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
