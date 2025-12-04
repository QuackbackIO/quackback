'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounce } from '@/lib/hooks/use-debounce'
import { InboxPostCard } from './inbox-post-card'
import { InboxEmptyState } from './inbox-empty-state'
import type { PostListItem, PostStatusEntity } from '@quackback/db'
import type { InboxFilters } from './use-inbox-filters'

interface InboxPostListProps {
  posts: PostListItem[]
  statuses: PostStatusEntity[]
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  selectedPostId: string | null
  onSelectPost: (id: string | null) => void
  onLoadMore: () => void
  sort: InboxFilters['sort']
  onSortChange: (sort: InboxFilters['sort']) => void
  search: string | undefined
  onSearchChange: (search: string | undefined) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
  headerAction?: React.ReactNode
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
  hasMore,
  isLoading,
  isLoadingMore,
  selectedPostId,
  onSelectPost,
  onLoadMore,
  sort,
  onSortChange,
  search,
  onSearchChange,
  hasActiveFilters,
  onClearFilters,
  headerAction,
}: InboxPostListProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const [searchValue, setSearchValue] = useState(search || '')
  const debouncedSearch = useDebounce(searchValue, 300)
  const isInitialMount = useRef(true)
  const lastSyncedSearch = useRef(search)

  // Sync search input when URL changes externally (e.g., clear filters)
  useEffect(() => {
    if (search !== lastSyncedSearch.current) {
      setSearchValue(search || '')
      lastSyncedSearch.current = search
    }
  }, [search])

  // Update filters when debounced search changes (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    if (debouncedSearch !== lastSyncedSearch.current) {
      lastSyncedSearch.current = debouncedSearch || undefined
      onSearchChange(debouncedSearch || undefined)
    }
  }, [debouncedSearch, onSearchChange])

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

  const headerContent = (
    <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border/50 px-3 py-2.5 flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className="pl-8 pr-8 h-8 text-sm bg-muted/30 border-border/50"
          data-search-input
        />
        {searchValue && (
          <button
            type="button"
            onClick={() => setSearchValue('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Select
        value={sort || 'newest'}
        onValueChange={(value) => onSortChange(value as 'newest' | 'oldest' | 'votes')}
      >
        <SelectTrigger className="h-8 w-[90px] text-xs border-border/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">Newest</SelectItem>
          <SelectItem value="oldest">Oldest</SelectItem>
          <SelectItem value="votes">Top Votes</SelectItem>
        </SelectContent>
      </Select>
      {headerAction}
    </div>
  )

  if (isLoading) {
    return (
      <div>
        {headerContent}
        <PostListSkeleton />
      </div>
    )
  }

  if (posts.length === 0) {
    return (
      <div>
        {headerContent}
        <InboxEmptyState
          type={hasActiveFilters ? 'no-results' : 'no-posts'}
          onClearFilters={hasActiveFilters ? onClearFilters : undefined}
        />
      </div>
    )
  }

  return (
    <div>
      {headerContent}

      {/* Post List */}
      <div className="divide-y divide-border/50">
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
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={onLoadMore}
                className="text-muted-foreground"
              >
                Load more
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
