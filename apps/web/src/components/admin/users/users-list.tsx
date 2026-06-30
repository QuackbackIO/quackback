import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { PlusIcon, UsersIcon } from '@heroicons/react/24/solid'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
import { useAssignUsersToSegment, useRemoveUsersFromSegment } from '@/lib/client/mutations'
import { EmptyState } from '@/components/shared/empty-state'
import { SearchInput } from '@/components/shared/search-input'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/shared/utils'
import { UserCard } from '@/components/admin/users/user-card'
import { UsersActiveFiltersBar } from '@/components/admin/users/users-active-filters-bar'
import { UsersBulkSegmentBar } from '@/components/admin/users/users-bulk-segment-bar'
import { MobileSegmentSelector } from '@/components/admin/users/users-segment-nav'
import type { PortalUserListItemView } from '@/lib/shared/types'
import type { UsersFilters } from '@/lib/shared/types'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'
import type { PrincipalId, SegmentId } from '@quackback/ids'

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
  // Segment props for mobile selector
  segments?: SegmentListItem[]
  selectedSegmentIds: string[]
  onSelectSegment: (segmentId: string, shiftKey: boolean) => void
  onClearSegments: () => void
  /** Opens the "New person" dialog; absent when the viewer can't manage people. */
  onNewPerson?: () => void
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'most_active', label: 'Most Active' },
  { value: 'last_active', label: 'Last Active' },
  { value: 'most_posts', label: 'Most Posts' },
  { value: 'most_comments', label: 'Most Comments' },
  { value: 'most_votes', label: 'Most Votes' },
  { value: 'name', label: 'Name A-Z' },
] as const

function UserListSkeleton() {
  return (
    <div className="p-3">
      <div className="rounded-xl overflow-hidden shadow-sm divide-y divide-border/50 bg-card border border-border/50">
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
    <div className="p-3">
      <div className="rounded-xl overflow-hidden shadow-sm bg-card border border-border/50">
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
      </div>
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
  filters,
  onFiltersChange,
  hasActiveFilters,
  onClearFilters,
  total,
  segments,
  selectedSegmentIds,
  onSelectSegment,
  onClearSegments,
  onNewPerson,
}: UsersListProps) {
  const intl = useIntl()
  const sort = filters.sort || 'newest'
  const { value: searchValue, setValue: setSearchValue } = useDebouncedSearch({
    externalValue: filters.search,
    onChange: (value) => onFiltersChange({ search: value }),
  })

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

  // Bulk segment selection — lets an admin add/remove many users to/from a
  // manual segment in one action instead of one navigate-open-popover cycle
  // per person. Selection is scoped to currently loaded rows.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const assignUsers = useAssignUsersToSegment()
  const removeUsers = useRemoveUsersFromSegment()
  const manualSegments = (segments ?? []).filter((s) => s.type === 'manual')
  const allLoadedSelected = users.length > 0 && users.every((u) => selectedIds.has(u.principalId))
  const someLoadedSelected = users.some((u) => selectedIds.has(u.principalId))

  const toggleSelect = (principalId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(principalId)) {
        next.delete(principalId)
      } else {
        next.add(principalId)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds(allLoadedSelected ? new Set() : new Set(users.map((u) => u.principalId)))
  }

  const handleBulkAdd = async (segmentId: SegmentId) => {
    const segment = manualSegments.find((s) => s.id === segmentId)
    const principalIds = Array.from(selectedIds) as PrincipalId[]
    try {
      const { assigned } = await assignUsers.mutateAsync({ segmentId, principalIds })
      setSelectedIds(new Set())
      toast.success(
        `Added ${assigned} ${assigned === 1 ? 'person' : 'people'} to ${segment?.name ?? 'segment'}`
      )
    } catch {
      toast.error(`Failed to add to ${segment?.name ?? 'segment'}`)
    }
  }

  const handleBulkRemove = async (segmentId: SegmentId) => {
    const segment = manualSegments.find((s) => s.id === segmentId)
    const principalIds = Array.from(selectedIds) as PrincipalId[]
    try {
      const { removed } = await removeUsers.mutateAsync({ segmentId, principalIds })
      setSelectedIds(new Set())
      toast.success(
        `Removed ${removed} ${removed === 1 ? 'person' : 'people'} from ${segment?.name ?? 'segment'}`,
        {
          action: {
            label: 'Undo',
            onClick: () => assignUsers.mutate({ segmentId, principalIds }),
          },
        }
      )
    } catch {
      toast.error(`Failed to remove from ${segment?.name ?? 'segment'}`)
    }
  }

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if in input/textarea/contenteditable
      const target = e.target as HTMLElement
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        if (e.key === 'Escape') {
          target.blur()
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
          document.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [users, selectedUserId, onSelectUser])

  const headerContent = (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2.5">
      {/* Mobile segment selector - only visible below lg */}
      <div className="lg:hidden mb-2">
        <MobileSegmentSelector
          segments={segments}
          selectedSegmentIds={selectedSegmentIds}
          onSelectSegment={onSelectSegment}
          onClearSegments={onClearSegments}
        />
      </div>

      {/* Search and Sort Row */}
      <div className="flex items-center gap-2">
        <SearchInput
          value={searchValue}
          onChange={setSearchValue}
          placeholder="Search users..."
          data-search-input
        />
        <div className="flex items-center gap-1 flex-wrap">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                'px-2.5 py-1 rounded-full text-[13px] transition-colors cursor-pointer whitespace-nowrap',
                sort === opt.value
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/50'
              )}
              onClick={() => handleSortChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {onNewPerson && (
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onNewPerson}>
            <PlusIcon className="h-3.5 w-3.5" />
            {intl.formatMessage({ id: 'admin.people.new.trigger', defaultMessage: 'New person' })}
          </Button>
        )}
      </div>

      {/* Active Filters Bar - Always visible */}
      <div className="mt-2">
        <UsersActiveFiltersBar
          filters={filters}
          onFiltersChange={onFiltersChange}
          onClearFilters={onClearFilters}
        />
      </div>

      {/* Count + select all */}
      <div className="mt-2 flex items-center gap-2">
        {!isLoading && users.length > 0 && (
          <Checkbox
            checked={allLoadedSelected ? true : someLoadedSelected ? 'indeterminate' : false}
            onCheckedChange={toggleSelectAll}
            aria-label="Select all loaded users"
          />
        )}
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? 'user' : 'users'}
        </span>
      </div>

      {/* Bulk segment action bar — only when one or more rows are checked */}
      {selectedIds.size > 0 && (
        <div className="mt-2">
          <UsersBulkSegmentBar
            selectedCount={selectedIds.size}
            manualSegments={manualSegments}
            onAdd={handleBulkAdd}
            onRemove={handleBulkRemove}
            onClear={() => setSelectedIds(new Set())}
            isPending={assignUsers.isPending || removeUsers.isPending}
          />
        </div>
      )}
    </div>
  )

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto w-full">
        {headerContent}
        <UserListSkeleton />
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div className="max-w-5xl mx-auto w-full">
        {headerContent}
        <UsersEmptyState hasActiveFilters={hasActiveFilters} onClearFilters={onClearFilters} />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto w-full">
      {headerContent}

      {/* User List */}
      <div className="p-3">
        <div className="rounded-xl overflow-hidden shadow-sm divide-y divide-border/50 bg-card border border-border/50">
          {users.map((user, index) => (
            <div
              key={user.principalId}
              className="animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
              style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
            >
              <UserCard
                user={user}
                isSelected={user.principalId === selectedUserId}
                onClick={() => onSelectUser(user.principalId)}
                checked={selectedIds.has(user.principalId)}
                onToggleCheck={() => toggleSelect(user.principalId)}
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
