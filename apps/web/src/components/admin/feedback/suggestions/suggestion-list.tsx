import { MagnifyingGlassIcon, SparklesIcon } from '@heroicons/react/24/solid'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SuggestionCard } from './suggestion-card'
import type { SuggestionListItem } from '../feedback-types'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'similarity', label: 'Similarity' },
  { value: 'confidence', label: 'Confidence' },
] as const

interface SuggestionListProps {
  suggestions: SuggestionListItem[]
  total: number
  selectedId: string | null
  onSelect: (suggestion: SuggestionListItem) => void
  search?: string
  onSearchChange: (search: string) => void
  sort?: string
  onSortChange: (sort: 'newest' | 'similarity' | 'confidence') => void
}

export function SuggestionList({
  suggestions,
  total,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  sort = 'newest',
  onSortChange,
}: SuggestionListProps) {
  return (
    <>
      {/* Search + Sort header */}
      <div className="px-3 py-2.5 border-b border-border/40 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              type="text"
              placeholder="Search suggestions..."
              value={search ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full h-8 pl-8 pr-3 text-xs bg-muted/30 border border-border/30 rounded-md outline-none focus:border-primary/40 focus:bg-background transition-colors placeholder:text-muted-foreground/40"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as 'newest' | 'similarity' | 'confidence')}
            className="h-8 px-2 text-xs bg-muted/30 border border-border/30 rounded-md outline-none focus:border-primary/40 text-muted-foreground cursor-pointer"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
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
          <div className="divide-y divide-border/20">
            {suggestions.map((suggestion, index) => (
              <div
                key={suggestion.id}
                className="animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
                style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
              >
                <SuggestionCard
                  suggestion={suggestion}
                  isSelected={suggestion.id === selectedId}
                  onClick={() => onSelect(suggestion)}
                />
              </div>
            ))}
          </div>

          <div className="px-4 py-3 text-center text-[11px] text-muted-foreground/50">
            {suggestions.length} of {total} pending
          </div>
        </ScrollArea>
      )}
    </>
  )
}
