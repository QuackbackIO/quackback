'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Search, X, Users } from 'lucide-react'
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
import { UserCard } from './user-card'
import type { PortalUserListItem } from '@quackback/domain'
import type { UsersFilters } from './use-users-filters'

interface UsersListProps {
  users: PortalUserListItem[]
  hasMore: boolean
  isLoading: boolean
  isLoadingMore: boolean
  selectedUserId: string | null
  onSelectUser: (id: string | null) => void
  onLoadMore: () => void
  sort: UsersFilters['sort']
  onSortChange: (sort: UsersFilters['sort']) => void
  search: string | undefined
  onSearchChange: (search: string | undefined) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
  total: number
}

function UserListSkeleton() {
  return (
    <div className="divide-y divide-border/50">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-32 mb-1.5" />
            <Skeleton className="h-3 w-48 mb-1" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  hasActiveFilters,
  onClearFilters,
}: {
  hasActiveFilters: boolean
  onClearFilters: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="rounded-full bg-muted p-3 mb-4">
        <Users className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-foreground mb-1">
        {hasActiveFilters ? 'No users match your filters' : 'No portal users yet'}
      </h3>
      <p className="text-sm text-muted-foreground max-w-[250px]">
        {hasActiveFilters
          ? "Try adjusting your filters to find what you're looking for."
          : 'Portal users will appear here when they sign up to your feedback portal.'}
      </p>
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-3 text-sm text-primary hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
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
  sort,
  onSortChange,
  search,
  onSearchChange,
  hasActiveFilters,
  onClearFilters,
  total,
}: UsersListProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const [searchValue, setSearchValue] = useState(search || '')
  const debouncedSearch = useDebounce(searchValue, 300)

  // Sync input when parent search changes (e.g., clear filters)
  useEffect(() => {
    setSearchValue(search || '')
  }, [search])

  // Update parent when debounced search changes
  const prevDebouncedRef = useRef(debouncedSearch)
  useEffect(() => {
    if (debouncedSearch !== prevDebouncedRef.current) {
      prevDebouncedRef.current = debouncedSearch
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

      const currentIndex = selectedUserId
        ? users.findIndex((u) => u.memberId === selectedUserId)
        : -1

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          if (users.length > 0) {
            const nextIndex = Math.min(currentIndex + 1, users.length - 1)
            onSelectUser(users[nextIndex]?.memberId ?? null)
          }
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          if (users.length > 0 && currentIndex > 0) {
            const prevIndex = Math.max(currentIndex - 1, 0)
            onSelectUser(users[prevIndex]?.memberId ?? null)
          }
          break
        case 'Escape':
          onSelectUser(null)
          break
        case '/':
          e.preventDefault()
          document.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [users, selectedUserId, onSelectUser])

  const headerContent = (
    <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border/50 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search users..."
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
          onValueChange={(value) =>
            onSortChange(value as 'newest' | 'oldest' | 'most_active' | 'name')
          }
        >
          <SelectTrigger className="h-8 w-[110px] text-xs border-border/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="most_active">Most Active</SelectItem>
            <SelectItem value="name">Name A-Z</SelectItem>
          </SelectContent>
        </Select>
      </div>
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
        <EmptyState hasActiveFilters={hasActiveFilters} onClearFilters={onClearFilters} />
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
            key={user.memberId}
            user={user}
            isSelected={user.memberId === selectedUserId}
            onClick={() => onSelectUser(user.memberId)}
          />
        ))}

        {/* Load more trigger */}
        {hasMore && (
          <div ref={loadMoreRef} className="py-4 flex justify-center">
            {isLoadingMore ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
