import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from '@heroicons/react/16/solid'
import { FilterList } from '../single-select-filter-list'
import { toggleItem } from '@/components/shared/filter-utils'
import { SourceTypeIcon, SOURCE_TYPE_LABELS } from '../source-type-icon'
import { FilterSection } from '@/components/shared/filter-section'
import type { SuggestionsFilters } from './use-suggestions-filters'
import type { FeedbackSourceView } from '../feedback-types'

interface SuggestionsFiltersSidebarProps {
  filters: SuggestionsFilters
  onFiltersChange: (updates: Partial<SuggestionsFilters>) => void
  sources: FeedbackSourceView[]
  /** Pending suggestion counts keyed by source type */
  countsBySourceType?: Map<string, number>
}

export function SuggestionsFiltersSidebar({
  filters,
  onFiltersChange,
  sources,
  countsBySourceType,
}: SuggestionsFiltersSidebarProps) {
  const handleSourceTypeSelect = (sourceType: string, addToSelection: boolean) => {
    if (addToSelection) {
      onFiltersChange({ sourceTypes: toggleItem(filters.sourceTypes, sourceType) })
    } else {
      const isOnlySelected =
        filters.sourceTypes?.length === 1 && filters.sourceTypes[0] === sourceType
      onFiltersChange({ sourceTypes: isOnlySelected ? undefined : [sourceType] })
    }
  }

  // Deduplicate sources by sourceType, keeping only external ones
  const uniqueSourceTypes = useMemo(() => {
    const seen = new Set<string>()
    const result: { sourceType: string; name: string }[] = []
    for (const s of sources) {
      if (s.sourceType === 'quackback' || seen.has(s.sourceType)) continue
      seen.add(s.sourceType)
      result.push({
        sourceType: s.sourceType,
        name: SOURCE_TYPE_LABELS[s.sourceType] || s.name || s.sourceType,
      })
    }
    return result
  }, [sources])

  return (
    <div className="space-y-0">
      {/* Source Filter — deduplicated by source type */}
      {uniqueSourceTypes.length > 0 && (
        <FilterSection title="Source">
          <FilterList
            items={uniqueSourceTypes.map((s) => ({
              id: s.sourceType,
              name: s.name,
              sourceType: s.sourceType,
              suggestionCount: countsBySourceType?.get(s.sourceType) ?? 0,
            }))}
            selectedIds={filters.sourceTypes || []}
            onSelect={handleSourceTypeSelect}
            renderItem={(item) => {
              const typed = item as {
                id: string
                name: string
                sourceType: string
                suggestionCount: number
              }
              const count = typed.suggestionCount
              return (
                <span className="flex items-center gap-2">
                  <SourceTypeIcon sourceType={typed.sourceType} size="xs" />
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
      {uniqueSourceTypes.length === 0 && (
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
