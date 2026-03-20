import { useMemo } from 'react'
import { InboxIcon } from '@heroicons/react/24/solid'
import { SearchInput } from '@/components/shared/search-input'
import { EmptyState } from '@/components/shared/empty-state'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { cn } from '@/lib/shared/utils'
import { SuggestionSourceGroup } from './suggestion-triage-row'
import { groupSuggestionsBySource } from './suggestion-grouping'
import type { SuggestionListItem } from '../feedback-types'

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
] as const

interface SuggestionListProps {
  suggestions: SuggestionListItem[]
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  onCreatePost: (suggestion: SuggestionListItem) => void
  onResolved: () => void
  search?: string
  onSearchChange: (search: string) => void
  sort?: string
  onSortChange: (sort: 'newest' | 'relevance') => void
  status: 'pending' | 'dismissed'
  onStatusChange: (status: 'pending' | 'dismissed') => void
  dismissedCount?: number
}

export function SuggestionList({
  suggestions,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onCreatePost,
  onResolved,
  search,
  onSearchChange,
  sort = 'relevance',
  onSortChange,
  status,
  onStatusChange,
  dismissedCount,
}: SuggestionListProps) {
  const { value: searchValue, setValue: setSearchValue } = useDebouncedSearch({
    externalValue: search,
    onChange: (v) => onSearchChange(v ?? ''),
  })

  const groups = useMemo(() => groupSuggestionsBySource(suggestions), [suggestions])

  const loadMoreRef = useInfiniteScroll({
    hasMore,
    isFetching: isLoadingMore,
    onLoadMore,
    rootMargin: '0px',
    threshold: 0.1,
  })

  const isDismissed = status === 'dismissed'

  const headerContent = (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 border border-border/50 rounded-lg p-0.5">
          {(['pending', 'dismissed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={cn(
                'px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer whitespace-nowrap',
                status === s
                  ? 'bg-muted text-foreground font-medium shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/50'
              )}
              onClick={() => onStatusChange(s)}
            >
              {s === 'pending' ? 'Active' : 'Dismissed'}
              {s === 'dismissed' && dismissedCount != null && dismissedCount > 0 && (
                <span className="ml-1 text-[10px] text-muted-foreground/50">
                  ({dismissedCount})
                </span>
              )}
            </button>
          ))}
        </div>
        <SearchInput
          value={searchValue}
          onChange={setSearchValue}
          placeholder="Search..."
          data-search-input
        />
        <div className="flex items-center gap-1">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                'px-2.5 py-1 rounded-full text-xs transition-colors cursor-pointer whitespace-nowrap',
                sort === opt.value
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/50'
              )}
              onClick={() => onSortChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto w-full">
      {headerContent}

      {/* Triage rows */}
      {suggestions.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title={isDismissed ? 'No dismissed suggestions' : 'No incoming feedback'}
          description={
            isDismissed
              ? 'Suggestions you dismiss will appear here for review.'
              : 'Feedback from connected sources like Zendesk, Intercom, and other integrations will appear here for triage.'
          }
        />
      ) : (
        <div className="p-3 space-y-3">
          {groups.map((group, index) => (
            <div
              key={group.rawItemId}
              className="rounded-xl overflow-hidden shadow-sm bg-card border border-border/50 animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
              style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
            >
              <SuggestionSourceGroup
                group={group}
                onCreatePost={onCreatePost}
                onResolved={onResolved}
                readOnly={isDismissed}
              />
            </div>
          ))}
        </div>
      )}

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
