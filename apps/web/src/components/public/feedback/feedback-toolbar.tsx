import { useState } from 'react'
import {
  ArrowTrendingUpIcon,
  ClockIcon,
  FireIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid'
import { FilterDropdown } from '@/components/public/feedback/filter-dropdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PostStatusEntity, Tag } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'

interface FeedbackToolbarProps {
  currentSort: 'top' | 'new' | 'trending'
  onSortChange: (sort: 'top' | 'new' | 'trending') => void
  currentSearch?: string
  onSearchChange: (search: string) => void
  statuses: PostStatusEntity[]
  tags: Tag[]
  selectedStatuses: string[]
  selectedTagIds: string[]
  onStatusChange: (statuses: string[]) => void
  onTagChange: (tagIds: string[]) => void
  onClearFilters: () => void
  activeFilterCount: number
  /** Show loading indicator */
  isLoading?: boolean
}

const SORT_OPTIONS = [
  { value: 'top', label: 'Top', icon: ArrowTrendingUpIcon },
  { value: 'new', label: 'New', icon: ClockIcon },
  { value: 'trending', label: 'Trending', icon: FireIcon },
] as const

export function FeedbackToolbar({
  currentSort,
  onSortChange,
  currentSearch,
  onSearchChange,
  statuses,
  tags,
  selectedStatuses,
  selectedTagIds,
  onStatusChange,
  onTagChange,
  onClearFilters,
  activeFilterCount,
  isLoading = false,
}: FeedbackToolbarProps): React.ReactElement {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState(currentSearch || '')

  function handleSearchSubmit(e: React.FormEvent): void {
    e.preventDefault()
    onSearchChange(searchValue)
    setSearchOpen(false)
  }

  function handleClearSearch(): void {
    setSearchValue('')
    onSearchChange('')
    setSearchOpen(false)
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
      <div className="flex items-center gap-1">
        {SORT_OPTIONS.map((option) => {
          const Icon = option.icon
          const isActive = currentSort === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSortChange(option.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors cursor-pointer',
                isActive
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', isActive && 'text-primary')} />
              {option.label}
            </button>
          )
        })}
        {isLoading && (
          <span className="ml-1 h-4 w-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
        )}
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 justify-between sm:justify-end w-full sm:w-auto">
        {/* Search */}
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <MagnifyingGlassIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Search</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <Input
                placeholder="Search posts..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="flex-1"
                autoFocus
              />
              <Button type="submit" size="sm">
                Search
              </Button>
            </form>
            {currentSearch && (
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={handleClearSearch}>
                Clear search
              </Button>
            )}
          </PopoverContent>
        </Popover>

        {/* Filter Dropdown */}
        <FilterDropdown
          statuses={statuses}
          tags={tags}
          selectedStatuses={selectedStatuses}
          selectedTagIds={selectedTagIds}
          onStatusChange={onStatusChange}
          onTagChange={onTagChange}
          onClearFilters={onClearFilters}
          activeCount={activeFilterCount}
        />
      </div>
    </div>
  )
}
