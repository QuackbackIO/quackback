import { useEffect, useRef } from 'react'
import { ArrowPathIcon, UsersIcon } from '@heroicons/react/24/solid'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { EmptyState } from '@/components/shared/empty-state'
import { SearchInput } from '@/components/shared/search-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { UserCard } from '@/components/admin/users/user-card'
import { UsersActiveFiltersBar } from '@/components/admin/users/users-active-filters-bar'
import type { PortalUserListItemView } from '@/lib/server/domains/users'
import type { UsersFilters } from '@/components/admin/users/use-users-filters'

interface UsersListProps {
  users: PortalUserListItemView[]
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  selectedUserId: string | null
  onSelectUser: (id: string | null) => void
  onLoadMore: () => void
  filters: UsersFilters
  onFiltersChange: (updates: Partial<UsersFilters>) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
  total: number
}

function UserListSkeleton() {
  return (
    <div className="divide-y divide-border/50">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 p-3">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-32 mb-1.5" />
            <Skeleton className="h-3 w-48 mb-1" />
            <Skeleton className="h-3 w-24 mb-1.5" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

function UsersEmptyState({
  hasActiveFilters,
  onClearFilters,
}: {
  hasActiveFilters: boolean
  onClearFilters: () => void
}) {
  return (
    <EmptyState
      icon={UsersIcon}
      title={hasActiveFilters ? 'No users match your filters' : 'No portal users yet'}
      description={
        hasActiveFilters
          ? "Try adjusting your filters to find what you're looking for."
          : 'Portal users will appear here when they sign up to your feedback portal.'
      }
      action={
        hasActiveFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="text-sm text-primary hover:underline"
          >
            Clear filters
          </button>
        ) : undefined
      }
      className="py-12"
    />
  )
}

export function UsersList({
  users,
  hasMore,
  isLoading,
  isLoadingMore,
  selectedUserId,
  onSelectUser,
  onLoadMore,
  filters,
  onFiltersChange,
  hasActiveFilters,
  onClearFilters,
  total,
}: UsersListProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleSearchChange = (value: string) => {
    onFiltersChange({ search: value || undefined })
  }

  const handleSortChange = (value: UsersFilters['sort']) => {
    onFiltersChange({ sort: value })
  }

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

      const currentIndex = selectedUserId
        ? users.findIndex((u) => u.principalId === selectedUserId)
        : -1

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          if (users.length > 0) {
            const nextIndex = Math.min(currentIndex + 1, users.length - 1)
            onSelectUser(users[nextIndex]?.principalId ?? null)
          }
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          if (users.length > 0 && currentIndex > 0) {
            const prevIndex = Math.max(currentIndex - 1, 0)
            onSelectUser(users[prevIndex]?.principalId ?? null)
          }
          break
        case 'Escape':
          onSelectUser(null)
          break
        case '/':
          e.preventDefault()
          searchInputRef.current?.focus()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [users, selectedUserId, onSelectUser])

  const headerContent = (
    <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border/50 px-3 py-2.5">
      {/* Search and Sort Row */}
      <div className="flex items-center gap-2">
        <SearchInput
          ref={searchInputRef}
          value={filters.search || ''}
          onChange={handleSearchChange}
          placeholder="Search users..."
        />
        <Select
          value={filters.sort || 'newest'}
          onValueChange={(value) => handleSortChange(value as UsersFilters['sort'])}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs border-border/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="most_active">Most Active</SelectItem>
            <SelectItem value="most_posts">Most Posts</SelectItem>
            <SelectItem value="most_comments">Most Comments</SelectItem>
            <SelectItem value="most_votes">Most Votes</SelectItem>
            <SelectItem value="name">Name A-Z</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Active Filters Bar - Always visible */}
      <div className="mt-2">
        <UsersActiveFiltersBar
          filters={filters}
          onFiltersChange={onFiltersChange}
          onClearFilters={onClearFilters}
        />
      </div>

      {/* Count */}
      <div className="mt-2 text-xs text-muted-foreground">
        {total} {total === 1 ? 'user' : 'users'}
      </div>
    </div>
  )

  if (isLoading) {
    return (
      <div>
        {headerContent}
        <UserListSkeleton />
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div>
        {headerContent}
        <UsersEmptyState hasActiveFilters={hasActiveFilters} onClearFilters={onClearFilters} />
      </div>
    )
  }

  return (
    <div>
      {headerContent}

      {/* User List */}
      <div className="divide-y divide-border/50">
        {users.map((user) => (
          <UserCard
            key={user.principalId}
            user={user}
            isSelected={user.principalId === selectedUserId}
            onClick={() => onSelectUser(user.principalId)}
          />
        ))}

        {/* Load more trigger */}
        {hasMore && (
          <div ref={loadMoreRef} className="py-4 flex justify-center">
            {isLoadingMore ? (
              <ArrowPathIcon className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <button
                type="button"
                onClick={onLoadMore}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Load more
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
