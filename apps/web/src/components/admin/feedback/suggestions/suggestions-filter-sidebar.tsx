import { FilterList, BoardFilterList } from '../single-select-filter-list'
import { toggleItem } from '../filter-utils'
import { SourceTypeIcon, SOURCE_TYPE_LABELS } from '../source-type-icon'
import { FilterSection } from '@/components/shared/filter-section'
import type { SuggestionsFilters } from './use-suggestions-filters'
import type { FeedbackSourceView } from '../feedback-types'
import type { Board } from '@/lib/shared/db-types'

interface SuggestionsFiltersSidebarProps {
  filters: SuggestionsFilters
  onFiltersChange: (updates: Partial<SuggestionsFilters>) => void
  sources: FeedbackSourceView[]
  boards: Board[]
  /** Pending suggestion counts keyed by source ID */
  suggestionCountsBySource?: Map<string, number>
}

export function SuggestionsFiltersSidebar({
  filters,
  onFiltersChange,
  sources,
  boards,
  suggestionCountsBySource,
}: SuggestionsFiltersSidebarProps) {
  const handleTypeSelect = (id: string) => {
    const current = filters.suggestionType
    if (current === id) {
      onFiltersChange({ suggestionType: undefined })
    } else {
      onFiltersChange({ suggestionType: id as 'merge_post' | 'create_post' })
    }
  }

  const handleSourceSelect = (id: string, addToSelection: boolean) => {
    if (addToSelection) {
      onFiltersChange({ sourceIds: toggleItem(filters.sourceIds, id) })
    } else {
      const isOnlySelected = filters.sourceIds?.length === 1 && filters.sourceIds[0] === id
      onFiltersChange({ sourceIds: isOnlySelected ? undefined : [id] })
    }
  }

  const handleBoardSelect = (id: string, addToSelection: boolean) => {
    if (addToSelection) {
      onFiltersChange({ board: toggleItem(filters.board, id) })
    } else {
      const isOnlySelected = filters.board?.length === 1 && filters.board[0] === id
      onFiltersChange({ board: isOnlySelected ? undefined : [id] })
    }
  }

  return (
    <div className="space-y-0">
      {/* Type Filter */}
      <FilterSection title="Type">
        <FilterList
          items={[
            { id: 'merge_post', name: 'Merge into post' },
            { id: 'create_post', name: 'New post' },
          ]}
          selectedIds={filters.suggestionType ? [filters.suggestionType] : []}
          onSelect={(id) => handleTypeSelect(id)}
        />
      </FilterSection>

      {/* Source Filter */}
      {sources.length > 0 && (
        <FilterSection title="Source">
          <FilterList
            items={sources.map((s) => ({
              id: s.id,
              name: s.name || SOURCE_TYPE_LABELS[s.sourceType] || s.sourceType,
              sourceType: s.sourceType,
              suggestionCount: suggestionCountsBySource?.get(s.id) ?? 0,
            }))}
            selectedIds={filters.sourceIds || []}
            onSelect={handleSourceSelect}
            renderItem={(item) => {
              const count = (item as any).suggestionCount as number
              return (
                <span className="flex items-center gap-2">
                  <SourceTypeIcon sourceType={(item as any).sourceType} size="xs" />
                  <span className="truncate">{item.name}</span>
                  {count > 0 && (
                    <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
                  )}
                </span>
              )
            }}
          />
        </FilterSection>
      )}

      {/* Board Filter */}
      {boards.length > 0 && (
        <FilterSection title="Board">
          <BoardFilterList
            boards={boards}
            selectedIds={filters.board || []}
            onSelect={handleBoardSelect}
          />
        </FilterSection>
      )}
    </div>
  )
}
