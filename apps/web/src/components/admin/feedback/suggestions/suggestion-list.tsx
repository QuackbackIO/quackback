import { useState, useEffect } from 'react'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SearchInput } from '@/components/shared/search-input'
import { cn } from '@/lib/shared/utils'
import { SuggestionTriageRow } from './suggestion-triage-row'
import type { SuggestionListItem } from '../feedback-types'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'similarity', label: 'Similarity' },
  { value: 'confidence', label: 'Confidence' },
] as const

interface SuggestionListProps {
  suggestions: SuggestionListItem[]
  total: number
  onCreatePost: (suggestion: SuggestionListItem) => void
  onResolved: () => void
  search?: string
  onSearchChange: (search: string) => void
  sort?: string
  onSortChange: (sort: 'newest' | 'similarity' | 'confidence') => void
}

export function SuggestionList({
  suggestions,
  total,
  onCreatePost,
  onResolved,
  search,
  onSearchChange,
  sort = 'newest',
  onSortChange,
}: SuggestionListProps) {
  const [searchValue, setSearchValue] = useState(search || '')

  // Sync input when parent search changes (e.g., clear filters)
  useEffect(() => {
    setSearchValue(search || '')
  }, [search])

  // Debounce search input before updating parent
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchValue !== (search || '')) {
        onSearchChange(searchValue)
      }
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [searchValue, search, onSearchChange])

  const headerContent = (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2.5">
      <div className="flex items-center gap-2">
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
    <div className="max-w-5xl mx-auto w-full flex flex-col flex-1 min-h-0">
      {headerContent}

      {/* Triage rows */}
      {suggestions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-muted/50 mb-4">
            <SparklesIcon className="h-6 w-6 text-muted-foreground/50" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">No pending suggestions</h3>
          <p className="text-xs text-muted-foreground/70 max-w-[240px] leading-relaxed">
            New suggestions appear here as the AI pipeline processes incoming feedback.
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-3">
            <div className="rounded-lg overflow-hidden divide-y divide-border/30 bg-card border border-border/40">
              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestion.id}
                  className="animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
                  style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
                >
                  <SuggestionTriageRow
                    suggestion={suggestion}
                    onCreatePost={onCreatePost}
                    onResolved={onResolved}
                  />
                </div>
              ))}
            </div>

            <div className="px-4 py-3 text-center text-[11px] text-muted-foreground/50">
              {suggestions.length} of {total} pending
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
