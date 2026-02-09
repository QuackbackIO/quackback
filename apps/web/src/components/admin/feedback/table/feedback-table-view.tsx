import { useEffect, useState } from 'react'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/shared/search-input'
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
import type { PostListItem, PostStatusEntity, Board, Tag } from '@/lib/shared/db-types'
import type { TeamMember } from '@/lib/server/domains/principals'
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
            {/* Vote button */}
            <Skeleton className="w-13 h-14 rounded-lg shrink-0 self-center mx-3" />
            {/* Content */}
            <div className="flex-1 min-w-0 px-3 py-2.5">
              {/* Status badge */}
              <Skeleton className="h-5 w-16 rounded-full mb-1" />
              {/* Title */}
              <Skeleton className="h-4 w-3/4 mb-1" />
              {/* Description */}
              <Skeleton className="h-3 w-full mb-1.5" />
              {/* Tags */}
              <div className="flex items-center gap-1 mb-1.5">
                <Skeleton className="h-4 w-12 rounded-full" />
                <Skeleton className="h-4 w-14 rounded-full" />
              </div>
              {/* Meta row: author · time · comments · board */}
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-16" />
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
  onStatusChange: _onStatusChange,
}: FeedbackTableViewProps): React.ReactElement {
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

  const loadMoreRef = useInfiniteScroll({
    hasMore,
    isFetching: isLoading || isLoadingMore,
    onLoadMore,
    rootMargin: '0px',
    threshold: 0.1,
  })

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

      switch (e.key) {
        case '/':
          e.preventDefault()
          document.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const headerContent = (
    <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border/50 px-3 py-2.5">
      {/* Search and Sort Row */}
      <div className="flex items-center gap-2">
        <SearchInput
          value={searchValue}
          onChange={setSearchValue}
          placeholder="Search..."
          data-search-input
        />
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
                onClick={() => onNavigateToPost(post.id)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Load more trigger */}
      {hasMore && (
        <div ref={loadMoreRef} className="px-3 pb-3 flex justify-center">
          {isLoadingMore ? (
            <Spinner />
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
