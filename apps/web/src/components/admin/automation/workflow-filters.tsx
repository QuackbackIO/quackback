import { useState } from 'react'
import { BoltIcon, TagIcon } from '@heroicons/react/24/outline'
import { FilterAddButton, FilterChip } from '@/components/shared/filter-chip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/shared/utils'

interface FilterOption {
  id: string
  label: string
}

interface WorkflowFiltersProps {
  statuses: ReadonlyArray<FilterOption>
  types: ReadonlyArray<FilterOption>
  status: string | null
  type: string | null
  onStatus: (status: string | null) => void
  onType: (type: string | null) => void
}

const MENU_ITEM =
  'flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] text-foreground/80 transition-colors hover:bg-muted/50'

/**
 * The workflow list's filter row: the active filters as chips, and a Filter
 * button that adds the ones not yet set.
 */
export function WorkflowFilters({
  statuses,
  types,
  status,
  type,
  onStatus,
  onType,
}: WorkflowFiltersProps) {
  const [open, setOpen] = useState(false)
  const statusLabel = statuses.find((option) => option.id === status)?.label
  const typeLabel = types.find((option) => option.id === type)?.label

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status !== null && statusLabel && (
        <FilterChip
          icon={TagIcon}
          label="Status"
          value={statusLabel}
          valueId={status}
          options={[...statuses]}
          onChange={onStatus}
          onRemove={() => onStatus(null)}
        />
      )}
      {type !== null && typeLabel && (
        <FilterChip
          icon={BoltIcon}
          label="Type"
          value={typeLabel}
          valueId={type}
          options={[...types]}
          onChange={onType}
          onRemove={() => onType(null)}
        />
      )}
      {(status === null || type === null) && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <FilterAddButton />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-0">
            <div className="py-1">
              {status === null && (
                <>
                  <p className="px-2.5 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
                    Status
                  </p>
                  {statuses.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={MENU_ITEM}
                      onClick={() => {
                        onStatus(option.id)
                        setOpen(false)
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </>
              )}
              {type === null && (
                <>
                  <p
                    className={cn(
                      'px-2.5 pt-1 pb-0.5 text-xs font-medium text-muted-foreground',
                      status === null && 'mt-1 border-t border-border/50 pt-2'
                    )}
                  >
                    Type
                  </p>
                  {types.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={MENU_ITEM}
                      onClick={() => {
                        onType(option.id)
                        setOpen(false)
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
