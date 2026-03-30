import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/shared/utils'
import { FilterSection } from '@/components/shared/filter-section'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import type { HelpCenterStatusFilter } from './use-help-center-filters'

interface HelpCenterFiltersProps {
  status: HelpCenterStatusFilter
  onStatusChange: (status: HelpCenterStatusFilter) => void
  category?: string
  onCategoryChange: (category: string | undefined) => void
}

const ARTICLE_STATUSES = [
  { id: 'all', name: 'All', color: undefined },
  { id: 'draft', name: 'Draft', color: '#6b7280' },
  { id: 'published', name: 'Published', color: '#22c55e' },
] as const

export function HelpCenterFiltersPanel({
  status,
  onStatusChange,
  category,
  onCategoryChange,
}: HelpCenterFiltersProps) {
  const { data: categories } = useQuery(helpCenterQueries.categories())

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

      {categories && categories.length > 0 && (
        <FilterSection title="Category">
          <div className="space-y-1" role="listbox" aria-label="Category filter">
            <button
              type="button"
              role="option"
              aria-selected={!category}
              onClick={() => onCategoryChange(undefined)}
              className={cn(
                'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                !category
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              All Categories
            </button>
            {categories.map((cat) => {
              const isSelected = category === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onCategoryChange(cat.id)}
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                    isSelected
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="truncate">{cat.name}</span>
                    <span className="text-muted-foreground/50 text-[10px]">{cat.articleCount}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </FilterSection>
      )}
    </div>
  )
}
