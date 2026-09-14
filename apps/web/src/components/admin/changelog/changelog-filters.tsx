import { FilterSection } from '@/components/shared/filter-section'
import { FilterList } from '@/components/admin/feedback/single-select-filter-list'
import type { ChangelogStatusFilter } from './use-changelog-filters'

interface ChangelogFiltersProps {
  status: ChangelogStatusFilter
  onStatusChange: (status: ChangelogStatusFilter) => void
}

const CHANGELOG_STATUSES: Array<{ id: ChangelogStatusFilter; name: string; color?: string }> = [
  { id: 'all', name: 'All' },
  { id: 'draft', name: 'Draft', color: '#6b7280' },
  { id: 'scheduled', name: 'Scheduled', color: '#3b82f6' },
  { id: 'published', name: 'Published', color: '#22c55e' },
]

export function ChangelogFiltersPanel({ status, onStatusChange }: ChangelogFiltersProps) {
  return (
    <div className="space-y-0">
      <FilterSection title="Status">
        <FilterList
          items={CHANGELOG_STATUSES}
          selectedIds={[status]}
          onSelect={(id) => onStatusChange(id as ChangelogStatusFilter)}
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
    </div>
  )
}
