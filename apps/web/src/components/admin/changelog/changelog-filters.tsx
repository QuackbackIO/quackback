import { useMemo, useState } from 'react'
import { defineMessages, useIntl } from 'react-intl'
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

const messages = defineMessages({
  all: { id: 'admin.changelog.status.all', defaultMessage: 'All' },
  draft: { id: 'admin.changelog.status.draft', defaultMessage: 'Draft' },
  scheduled: { id: 'admin.changelog.status.scheduled', defaultMessage: 'Scheduled' },
  published: { id: 'admin.changelog.status.published', defaultMessage: 'Published' },
  status: { id: 'admin.changelog.filters.status', defaultMessage: 'Status' },
  filter: { id: 'admin.changelog.filters.add', defaultMessage: 'Filter' },
  newest: { id: 'admin.changelog.sort.newest', defaultMessage: 'Newest' },
  oldest: { id: 'admin.changelog.sort.oldest', defaultMessage: 'Oldest' },
})

const STATUS_COLORS: Array<{ id: ChangelogStatusFilter; color?: string }> = [
  { id: 'all' },
  { id: 'draft', color: '#6b7280' },
  { id: 'scheduled', color: '#3b82f6' },
  { id: 'published', color: '#22c55e' },
]

/** The entry statuses to filter by, named in the viewer's language. */
function useChangelogStatuses() {
  const intl = useIntl()
  return useMemo(
    () => STATUS_COLORS.map((item) => ({ ...item, name: intl.formatMessage(messages[item.id]) })),
    [intl]
  )
}

export function ChangelogFiltersPanel({ status, onStatusChange }: ChangelogFiltersProps) {
  const intl = useIntl()
  const statuses = useChangelogStatuses()
  return (
    <div className="space-y-0">
      <FilterSection title={intl.formatMessage(messages.status)}>
        <FilterList
          items={statuses}
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

/** The list's sort choices, named in the viewer's language. */
export function useChangelogSortOptions(): Array<{ value: ChangelogSort; label: string }> {
  const intl = useIntl()
  return useMemo(
    () => [
      { value: 'newest', label: intl.formatMessage(messages.newest) },
      { value: 'oldest', label: intl.formatMessage(messages.oldest) },
    ],
    [intl]
  )
}

/** The Filter control for the list toolbar: picks an entry status. */
export function ChangelogFilterButton({ status, onStatusChange }: ChangelogFiltersProps) {
  const intl = useIntl()
  const statuses = useChangelogStatuses()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterAddButton>{intl.formatMessage(messages.filter)}</FilterAddButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        {statuses.map((item) => (
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
