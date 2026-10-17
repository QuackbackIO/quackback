import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import {
  ArrowTrendingUpIcon,
  ClockIcon,
  FireIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
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
    value: 'trending',
    messageId: 'portal.feedback.toolbar.sortTrending',
    defaultMessage: 'Trending',
    icon: FireIcon,
  },
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
  // A local debounce rather than the shared useDebouncedSearch: importing that
  // hook into the portal bundle splits it out of the admin chunk it lives in,
  // costing admin pages an extra request.
  const [searchValue, setSearchValue] = useState(currentSearch ?? '')
  // The last query this field applied. When the URL catches up to it, the
  // field keeps whatever was typed meanwhile; any other change (Clear all,
  // Back) comes from elsewhere and replaces the field.
  const appliedRef = useRef((currentSearch ?? '').trim())
  const onSearchChangeRef = useRef(onSearchChange)
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange
  })
  useEffect(() => {
    const external = currentSearch ?? ''
    if (external.trim() === appliedRef.current) return
    appliedRef.current = external.trim()
    setSearchValue(external)
  }, [currentSearch])
  useEffect(() => {
    const query = searchValue.trim()
    if (query === appliedRef.current) return
    const timeoutId = setTimeout(() => {
      appliedRef.current = query
      onSearchChangeRef.current(query)
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [searchValue])
  const searchLabel = intl.formatMessage({
    id: 'portal.feedback.toolbar.searchLabel',
    defaultMessage: 'Search ideas',
  })

  function handleClearSearch(): void {
    setSearchValue('')
    appliedRef.current = ''
    onSearchChange('')
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-4">
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

      <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-transparent ps-3 pe-1 text-sm focus-within:ring-2 focus-within:ring-ring/50">
          <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {searchValue && (
            <button
              type="button"
              onClick={handleClearSearch}
              aria-label={intl.formatMessage({
                id: 'portal.feedback.toolbar.clearSearch',
                defaultMessage: 'Clear search',
              })}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </label>

        {filterButton}
      </div>
    </div>
  )
}
