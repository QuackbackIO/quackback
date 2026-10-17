import { useIntl } from 'react-intl'
import { ArrowTrendingUpIcon, ClockIcon, FireIcon } from '@heroicons/react/24/solid'
import { SearchInput } from '@/components/shared/search-input'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
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
  const search = useDebouncedSearch({
    externalValue: currentSearch,
    onChange: (value) => onSearchChange(value ?? ''),
  })
  const searchLabel = intl.formatMessage({
    id: 'portal.feedback.toolbar.searchLabel',
    defaultMessage: 'Search ideas',
  })

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

      <div className="flex flex-1 basis-56 items-center gap-2">
        <SearchInput
          value={search.value}
          onChange={search.setValue}
          placeholder={searchLabel}
          clearLabel={intl.formatMessage({
            id: 'portal.feedback.toolbar.clearSearch',
            defaultMessage: 'Clear search',
          })}
          className="rounded-full border-border"
        />

        {filterButton}
      </div>
    </div>
  )
}
