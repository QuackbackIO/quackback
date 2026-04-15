import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/shared/utils'
import { FilterSection } from '@/components/shared/filter-section'
import { FilterList } from '@/components/admin/feedback/single-select-filter-list'
import { HelpCenterCategoryTree, type CategoryActions } from './help-center-category-tree'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import type { HelpCenterStatusFilter } from './use-help-center-filters'
import type { HelpCenterCategoryId } from '@quackback/ids'

interface HelpCenterFiltersProps {
  status: HelpCenterStatusFilter
  onStatusChange: (status: HelpCenterStatusFilter) => void
  selectedCategoryId: string | undefined
  onSelectCategory: (id: HelpCenterCategoryId | null) => void
  categoryActions: CategoryActions
  showDeleted?: boolean
  onShowDeletedChange?: (showDeleted: boolean | undefined) => void
}

const ARTICLE_STATUSES = [
  { id: 'all', name: 'All', color: undefined },
  { id: 'draft', name: 'Draft', color: '#6b7280' },
  { id: 'published', name: 'Published', color: '#22c55e' },
] as const

export function HelpCenterFiltersPanel({
  status,
  onStatusChange,
  selectedCategoryId,
  onSelectCategory,
  categoryActions,
  showDeleted,
  onShowDeletedChange,
}: HelpCenterFiltersProps) {
  const { data: categories = [] } = useQuery(helpCenterQueries.categories())

  return (
    <div className="space-y-0">
      <FilterSection title="Status">
        <div className="space-y-1" role="listbox" aria-label="Status filter">
          {ARTICLE_STATUSES.map((item) => {
            const isSelected = status === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onStatusChange(item.id as HelpCenterStatusFilter)}
                className={cn(
                  'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                  isSelected
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                <span className="flex items-center gap-2">
                  {item.color && (
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{item.name}</span>
                </span>
              </button>
            )
          })}
        </div>
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
          items={[{ id: 'deleted', name: 'Deleted items' }]}
          selectedIds={showDeleted ? ['deleted'] : []}
          onSelect={() => {
            onShowDeletedChange?.(!showDeleted || undefined)
          }}
        />
      </FilterSection>
    </div>
  )
}
