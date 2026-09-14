import { useQuery } from '@tanstack/react-query'
import { FilterSection } from '@/components/shared/filter-section'
import { FilterList } from '@/components/admin/feedback/single-select-filter-list'
import { HelpCenterCategoryTree, type CategoryActions } from './help-center-category-tree'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import type { HelpCenterStatusFilter } from './use-help-center-filters'
import type { KbCategoryId } from '@quackback/ids'

interface HelpCenterFiltersProps {
  status: HelpCenterStatusFilter
  onStatusChange: (status: HelpCenterStatusFilter) => void
  selectedCategoryId: string | undefined
  onSelectCategory: (id: KbCategoryId | null) => void
  categoryActions: CategoryActions
  showDeleted?: boolean
  onShowDeletedChange?: (showDeleted: boolean | undefined) => void
  showPerformance?: boolean
  onShowPerformanceChange?: (showPerformance: boolean | undefined) => void
}

const ARTICLE_STATUSES: Array<{ id: HelpCenterStatusFilter; name: string; color?: string }> = [
  { id: 'all', name: 'All' },
  { id: 'draft', name: 'Draft', color: '#6b7280' },
  { id: 'published', name: 'Published', color: '#22c55e' },
]

export function HelpCenterFiltersPanel({
  status,
  onStatusChange,
  selectedCategoryId,
  onSelectCategory,
  categoryActions,
  showDeleted,
  onShowDeletedChange,
  showPerformance,
  onShowPerformanceChange,
}: HelpCenterFiltersProps) {
  const { data: categories = [] } = useQuery(helpCenterQueries.categories())

  return (
    <div className="space-y-0">
      <FilterSection title="Status">
        <FilterList
          items={ARTICLE_STATUSES}
          selectedIds={[status]}
          onSelect={(id) => onStatusChange(id as HelpCenterStatusFilter)}
          renderItem={(item) => (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {item.color && (
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
              )}
              <span className="truncate">{item.name}</span>
            </span>
          )}
        />
      </FilterSection>

      <FilterSection title="Categories">
        <HelpCenterCategoryTree
          categories={categories}
          selectedId={selectedCategoryId}
          onNavigate={onSelectCategory}
          actions={categoryActions}
        />
      </FilterSection>

      <FilterSection title="Other">
        <FilterList
          items={[
            { id: 'performance', name: 'Article performance' },
            { id: 'deleted', name: 'Deleted items' },
          ]}
          selectedIds={[
            ...(showPerformance ? ['performance'] : []),
            ...(showDeleted ? ['deleted'] : []),
          ]}
          onSelect={(id) => {
            if (id === 'deleted') {
              onShowDeletedChange?.(!showDeleted || undefined)
            } else {
              onShowPerformanceChange?.(!showPerformance || undefined)
            }
          }}
        />
      </FilterSection>
    </div>
  )
}
