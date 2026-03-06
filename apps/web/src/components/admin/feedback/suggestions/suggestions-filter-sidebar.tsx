import { Link } from '@tanstack/react-router'
import { PlusIcon } from '@heroicons/react/16/solid'
import { FilterList } from '../single-select-filter-list'
import { toggleItem } from '../filter-utils'
import { SourceTypeIcon, SOURCE_TYPE_LABELS } from '../source-type-icon'
import { FilterSection } from '@/components/shared/filter-section'
import type { SuggestionsFilters } from './use-suggestions-filters'
import type { FeedbackSourceView } from '../feedback-types'

interface SuggestionsFiltersSidebarProps {
  filters: SuggestionsFilters
  onFiltersChange: (updates: Partial<SuggestionsFilters>) => void
  sources: FeedbackSourceView[]
  /** Pending suggestion counts keyed by source ID */
  suggestionCountsBySource?: Map<string, number>
}

export function SuggestionsFiltersSidebar({
  filters,
  onFiltersChange,
  sources,
  suggestionCountsBySource,
}: SuggestionsFiltersSidebarProps) {
  const handleSourceSelect = (id: string, addToSelection: boolean) => {
    if (addToSelection) {
      onFiltersChange({ sourceIds: toggleItem(filters.sourceIds, id) })
    } else {
      const isOnlySelected = filters.sourceIds?.length === 1 && filters.sourceIds[0] === id
      onFiltersChange({ sourceIds: isOnlySelected ? undefined : [id] })
    }
  }

  const externalSources = sources.filter((s) => s.sourceType !== 'quackback')

  return (
    <div className="space-y-0">
      {/* Source Filter — external sources only */}
      {externalSources.length > 0 && (
        <FilterSection title="Source">
          <FilterList
            items={externalSources.map((s) => ({
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

      {/* Connect sources prompt */}
      {externalSources.length === 0 && (
        <div className="px-1">
          <Link
            to="/admin/settings/integrations"
            className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Connect a source
          </Link>
        </div>
      )}
    </div>
  )
}
