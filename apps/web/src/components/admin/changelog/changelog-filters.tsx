import { useState } from 'react'
import { MegaphoneIcon } from '@heroicons/react/16/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MENU_ROW } from '@/components/ui/menu'
import { FilterAddButton } from '@/components/shared/filter-chip'
import { cn } from '@/lib/shared/utils'
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
              <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                {item.color ? (
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                ) : (
                  <MegaphoneIcon className="size-4" />
                )}
              </span>
              <span className="truncate">{item.name}</span>
            </span>
          )}
        />
      </FilterSection>
    </div>
  )
}

export type ChangelogSort = 'newest' | 'oldest'

export const CHANGELOG_SORT_OPTIONS: Array<{ value: ChangelogSort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]

/** The Filter control for the list toolbar: picks an entry status. */
export function ChangelogFilterButton({ status, onStatusChange }: ChangelogFiltersProps) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterAddButton />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        {CHANGELOG_STATUSES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onStatusChange(item.id)
              setOpen(false)
            }}
            className={cn(
              MENU_ROW,
              'w-full hover:bg-muted/50',
              item.id === status ? 'bg-muted font-medium' : 'text-muted-foreground'
            )}
          >
            {item.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
