import { useCallback, useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { PlusIcon, TagIcon, UsersIcon, ViewColumnsIcon } from '@heroicons/react/24/solid'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
import { EmptyState } from '@/components/shared/empty-state'
import { SearchInput } from '@/components/shared/search-input'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MENU_ICON, MENU_LABEL } from '@/components/ui/menu'
import { cn } from '@/lib/shared/utils'
import {
  UserCard,
  METRIC_COLUMN_WIDTH,
  EMAIL_COLUMN_WIDTH,
  JOINED_COLUMN_WIDTH,
  COUNTRY_COLUMN_WIDTH,
} from '@/components/admin/users/user-card'
import { UsersActiveFiltersBar } from '@/components/admin/users/users-active-filters-bar'
import { useUserTags } from '@/lib/client/hooks/use-user-tags'
import { MobileSegmentSelector } from '@/components/admin/users/users-segment-nav'
import type { PortalUserListItemView } from '@/lib/shared/types'
import type { UsersFilters } from '@/lib/shared/types'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'

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
  /** Kept so callers do not change; list rows no longer multi-select. */
  canManage?: boolean
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

const SHOW_COUNTRY_STORAGE_KEY = 'quackback:users-list:show-country'

/**
 * The Country column opt-in persists per teammate in localStorage, so the
 * table keeps the shape each teammate picked across sessions. The initial
 * state reads storage synchronously via a lazy initializer instead of
 * hydrating in a mount effect.
 */
function useShowCountryColumn(): [boolean, (next: boolean) => void] {
  const [showCountry, setShowCountry] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SHOW_COUNTRY_STORAGE_KEY) === '1'
    } catch {
      // Unavailable storage (SSR, private browsing) — the column starts hidden.
      return false
    }
  })
  const setPersisted = useCallback((next: boolean) => {
    setShowCountry(next)
    try {
      window.localStorage.setItem(SHOW_COUNTRY_STORAGE_KEY, next ? '1' : '0')
    } catch {
      // Storage may be unavailable — the in-memory choice still applies for
      // this session.
    }
  }, [])
  return [showCountry, setPersisted]
}

function UserListSkeleton() {
  return (
    <div className="p-3">
      <div className="rounded-xl overflow-hidden shadow-sm divide-y divide-border/50 bg-card border border-border/50">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <Skeleton className="h-4 flex-1 min-w-0" />
            <Skeleton className={cn('h-3', EMAIL_COLUMN_WIDTH)} />
            <Skeleton className={cn('h-3', JOINED_COLUMN_WIDTH)} />
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

/**
 * People-list tag filter: checkbox menu over every live user tag, OR logic —
 * a person carrying ANY selected tag matches. Renders nothing when no tags
 * exist yet (tags are minted from the profile tag control).
 */
function UserTagFilterDropdown({
  selectedTagIds,
  onChange,
}: {
  selectedTagIds: string[]
  onChange: (tagIds: string[]) => void
}) {
  const { data: tags } = useUserTags()
  if (!tags || tags.length === 0) return null

  const toggle = (tagId: string, checked: boolean) => {
    onChange(checked ? [...selectedTagIds, tagId] : selectedTagIds.filter((id) => id !== tagId))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 text-xs gap-1.5',
            selectedTagIds.length > 0 && 'border-primary/40 text-primary'
          )}
        >
          <TagIcon className={MENU_ICON} />
          Tags{selectedTagIds.length > 0 ? ` (${selectedTagIds.length})` : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {tags.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag.id}
            checked={selectedTagIds.includes(tag.id)}
            onCheckedChange={(checked) => toggle(tag.id, checked === true)}
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            {tag.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  // Column picker — extra fields a teammate can opt into per row. Starts
  // empty so the default list stays exactly as dense as it's always been.
  const [showCountry, setShowCountry] = useShowCountryColumn()
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
        <UserTagFilterDropdown
          selectedTagIds={filters.tagIds ?? []}
          onChange={(tagIds) => onFiltersChange({ tagIds: tagIds.length > 0 ? tagIds : undefined })}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
              <ViewColumnsIcon className={MENU_ICON} />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuCheckboxItem checked={showCountry} onCheckedChange={setShowCountry}>
              Country
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
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

      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? 'user' : 'users'}
        </span>
      </div>
    </div>
  )

  if (isLoading) {
    return (
      <div className="max-w-5xl w-full">
        {headerContent}
        <UserListSkeleton />
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div className="max-w-5xl w-full">
        {headerContent}
        <UsersEmptyState hasActiveFilters={hasActiveFilters} onClearFilters={onClearFilters} />
      </div>
    )
  }

  return (
    <div className="max-w-5xl w-full">
      {headerContent}

      {/* User List */}
      <div className="p-3">
        <div className="rounded-xl overflow-hidden shadow-sm bg-card border border-border/50">
          {/* Column headers — kept in sync with each row's avatar
              spacer and the column-width constants in `user-card.tsx` so every
              label lands directly above the field it describes, giving the
              list a vertical lane to scan down instead of a stacked cell. */}
          <div className="flex items-center gap-3 border-b border-border/50 px-3 py-2">
            <div className="h-8 w-8 shrink-0" aria-hidden="true" />
            <span className={cn('min-w-0 flex-1', MENU_LABEL)}>Name</span>
            <span className={cn(EMAIL_COLUMN_WIDTH, MENU_LABEL, 'shrink-0')}>Email</span>
            <span className={cn(JOINED_COLUMN_WIDTH, MENU_LABEL, 'shrink-0')}>Joined</span>
            {showCountry && (
              <span className={cn(COUNTRY_COLUMN_WIDTH, MENU_LABEL, 'shrink-0')}>Country</span>
            )}
            <div className="flex shrink-0 items-center gap-3">
              <span className={cn(METRIC_COLUMN_WIDTH, MENU_LABEL, 'text-right')}>Posts</span>
              <span className={cn(METRIC_COLUMN_WIDTH, MENU_LABEL, 'text-right')}>Comments</span>
              <span className={cn(METRIC_COLUMN_WIDTH, MENU_LABEL, 'text-right')}>Votes</span>
            </div>
          </div>
          <div className="divide-y divide-border/50">
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
                  showCountry={showCountry}
                />
              </div>
            ))}
          </div>
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
