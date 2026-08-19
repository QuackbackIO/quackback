import { FilterSection } from '@/components/shared/filter-section'
import { cn } from '@/lib/shared/utils'
import type { ChangelogStatusFilter } from './use-changelog-filters'

interface ChangelogFiltersProps {
  status: ChangelogStatusFilter
  onStatusChange: (status: ChangelogStatusFilter) => void
}

const CHANGELOG_STATUSES = [
  { id: 'all', name: 'All', color: undefined },
  { id: 'draft', name: 'Draft', color: '#6b7280' }, // gray
  { id: 'scheduled', name: 'Scheduled', color: '#3b82f6' }, // blue
  { id: 'published', name: 'Published', color: '#22c55e' }, // green
] as const

export function ChangelogFiltersPanel({ status, onStatusChange }: ChangelogFiltersProps) {
  return (
    <div className="space-y-0">
      <FilterSection title="Status">
        <div className="space-y-1" role="listbox" aria-label="Status filter">
          {CHANGELOG_STATUSES.map((item) => {
            const isSelected = status === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onStatusChange(item.id as ChangelogStatusFilter)}
                className={cn(
                  'w-full text-left px-2.5 py-1.5 rounded-md text-[13px] font-normal transition-colors',
                  isSelected
                    ? 'bg-muted text-foreground font-medium'
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
    </div>
  )
}
