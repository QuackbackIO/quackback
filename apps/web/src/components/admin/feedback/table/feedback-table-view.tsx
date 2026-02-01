import { useEffect, useRef, useState } from 'react'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/solid'
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
import { InboxEmptyState } from '@/components/admin/feedback/inbox-empty-state'
import { ActiveFiltersBar } from '@/components/admin/feedback/active-filters-bar'
import { FeedbackRow } from './feedback-row'
import type { PostListItem, PostStatusEntity, Board, Tag } from '@/lib/db-types'
import type { TeamMember } from '@/lib/server/domains/members'
import type { InboxFilters } from '@/components/admin/feedback/use-inbox-filters'
import type { StatusId } from '@quackback/ids'

interface FeedbackTableViewProps {
  posts: PostListItem[]
  statuses: PostStatusEntity[]
  boards: Board[]
  tags: Tag[]
  members: TeamMember[]
  filters: InboxFilters
  onFiltersChange: (updates: Partial<InboxFilters>) => void
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  focusedPostId: string | null
  onFocusPost: (id: string | null) => void
  onNavigateToPost: (id: string) => void
  onLoadMore: () => void
  sort: InboxFilters['sort']
  onSortChange: (sort: InboxFilters['sort']) => void
  search: string | undefined
  onSearchChange: (search: string | undefined) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
  headerAction?: React.ReactNode
  onToggleStatus: (slug: string) => void
  onToggleBoard: (id: string) => void
  onStatusChange: (postId: string, statusId: StatusId) => void
}

function TableSkeleton() {
  return (
    <div className="p-3">
      <div className="rounded-lg overflow-hidden divide-y divide-border/30 bg-card border border-border/40">
        {Array.from({ length: 6 }).map((_, rowIdx) => (
          <div key={rowIdx} className="flex py-1 px-3">
            <div className="flex flex-col items-center justify-center w-16 shrink-0 border-r border-border/30 py-2.5">
              <Skeleton className="h-4 w-4 mb-1" />
              <Skeleton className="h-4 w-6" />
            </div>
            <div className="flex-1 min-w-0 px-3 py-2.5">
              <Skeleton className="h-4 w-3/4 mb-1" />
              <Skeleton className="h-3 w-full mb-1.5" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function FeedbackTableView({
  posts,
  statuses,
  boards,
  tags,
  members,
  filters,
  onFiltersChange,
  hasMore,
  isLoading,
  isLoadingMore,
  focusedPostId,
  onFocusPost,
  onNavigateToPost,
  onLoadMore,
  sort,
  onSortChange,
  search,
  onSearchChange,
  hasActiveFilters,
  onClearFilters,
  headerAction,
  onToggleStatus,
  onToggleBoard,
  onStatusChange,
}: FeedbackTableViewProps): React.ReactElement {
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const [searchValue, setSearchValue] = useState(search || '')

  // Sync input when parent search changes (e.g., clear filters)
  useEffect(() => {
    setSearchValue(search || '')
  }, [search])

  // Debounce search input before updating parent
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchValue !== (search || '')) {
        onSearchChange(searchValue || undefined)
      }
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [searchValue, search, onSearchChange])

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

      const currentIndex = focusedPostId ? posts.findIndex((p) => p.id === focusedPostId) : -1

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          if (posts.length > 0) {
            const nextIndex = Math.min(currentIndex + 1, posts.length - 1)
            onFocusPost(posts[nextIndex]?.id ?? null)
          }
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          if (posts.length > 0 && currentIndex > 0) {
            const prevIndex = Math.max(currentIndex - 1, 0)
            onFocusPost(posts[prevIndex]?.id ?? null)
          }
          break
        case 'Enter':
          if (focusedPostId) {
            e.preventDefault()
            onNavigateToPost(focusedPostId)
          }
          break
        case 'Escape':
          onFocusPost(null)
          break
        case '/':
          e.preventDefault()
          document.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [posts, focusedPostId, onFocusPost, onNavigateToPost])

  const headerContent = (
    <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border/50 px-3 py-2.5">
      {/* Search and Sort Row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
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
              <XMarkIcon className="h-3.5 w-3.5" />
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

      {/* Active Filters Bar - Always visible */}
      <div className="mt-2">
        <ActiveFiltersBar
          filters={filters}
          onFiltersChange={onFiltersChange}
          onClearAll={onClearFilters}
          boards={boards}
          tags={tags}
          statuses={statuses}
          members={members}
          onToggleStatus={onToggleStatus}
          onToggleBoard={onToggleBoard}
        />
      </div>
    </div>
  )

  if (isLoading) {
    return (
      <div>
        {headerContent}
        <TableSkeleton />
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
      <div className="p-3">
        <div className="rounded-lg overflow-hidden divide-y divide-border/30 bg-card border border-border/40">
          {posts.map((post, index) => (
            <div
              key={post.id}
              className="animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
              style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
            >
              <FeedbackRow
                post={post}
                statuses={statuses}
                isFocused={post.id === focusedPostId}
                onClick={() => onNavigateToPost(post.id)}
                onStatusChange={(statusId) => onStatusChange(post.id, statusId)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Load more trigger */}
      {hasMore && (
        <div ref={loadMoreRef} className="px-3 pb-3 flex justify-center">
          {isLoadingMore ? (
            <span className="h-5 w-5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
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
  )
}
