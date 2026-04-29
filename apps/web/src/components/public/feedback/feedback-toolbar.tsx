import { useState } from 'react'
import { useIntl, FormattedMessage } from 'react-intl'
import {
  ArrowTrendingUpIcon,
  ClockIcon,
  FireIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/shared/utils'

interface FeedbackToolbarProps {
  currentSort: 'top' | 'new' | 'trending'
  onSortChange: (sort: 'top' | 'new' | 'trending') => void
  currentSearch?: string
  onSearchChange: (search: string) => void
  /** Show loading indicator */
  isLoading?: boolean
  /** Optional slot rendered after the search button on the right (typically the Filter button). */
  filterButton?: React.ReactNode
}

const SORT_OPTIONS = [
  {
    value: 'top',
    messageId: 'portal.feedback.toolbar.sortTop',
    defaultMessage: 'Top',
    icon: ArrowTrendingUpIcon,
  },
  {
    value: 'new',
    messageId: 'portal.feedback.toolbar.sortNew',
    defaultMessage: 'New',
    icon: ClockIcon,
  },
  {
    value: 'trending',
    messageId: 'portal.feedback.toolbar.sortTrending',
    defaultMessage: 'Trending',
    icon: FireIcon,
  },
] as const

export function FeedbackToolbar({
  currentSort,
  onSortChange,
  currentSearch,
  onSearchChange,
  isLoading = false,
  filterButton,
}: FeedbackToolbarProps): React.ReactElement {
  const intl = useIntl()
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
    <div className="flex items-center justify-between gap-3 sm:gap-4">
      <div className="flex items-center gap-1 min-w-0">
        {SORT_OPTIONS.map((option) => {
          const Icon = option.icon
          const isActive = currentSort === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSortChange(option.value)}
              className={cn(
                'flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-full text-sm transition-colors cursor-pointer',
                isActive
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', isActive && 'text-primary')} />
              {intl.formatMessage({ id: option.messageId, defaultMessage: option.defaultMessage })}
            </button>
          )
        })}
        {isLoading && (
          <span className="ml-1 h-4 w-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Search */}
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <MagnifyingGlassIcon className="h-4 w-4" />
              <span className="hidden sm:inline">
                <FormattedMessage id="portal.feedback.toolbar.search" defaultMessage="Search" />
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="max-w-[calc(100vw-2rem)] sm:w-80" align="end">
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <Input
                placeholder={intl.formatMessage({
                  id: 'portal.feedback.toolbar.searchPlaceholder',
                  defaultMessage: 'Search posts...',
                })}
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="flex-1"
                autoFocus
              />
              <Button type="submit" size="sm">
                <FormattedMessage
                  id="portal.feedback.toolbar.searchSubmit"
                  defaultMessage="Search"
                />
              </Button>
            </form>
            {currentSearch && (
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={handleClearSearch}>
                <FormattedMessage
                  id="portal.feedback.toolbar.clearSearch"
                  defaultMessage="Clear search"
                />
              </Button>
            )}
          </PopoverContent>
        </Popover>

        {filterButton}
      </div>
    </div>
  )
}
