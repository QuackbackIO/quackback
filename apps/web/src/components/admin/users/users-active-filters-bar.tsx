import { useMemo, useState } from 'react'
import {
  XMarkIcon,
  EnvelopeIcon,
  CalendarIcon,
  PlusIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { UsersFilters } from '@/components/admin/users/use-users-filters'

interface FilterOption {
  id: string
  label: string
}

interface ActiveFilter {
  key: string
  type: 'verified' | 'dateFrom' | 'dateTo' | 'dateRange'
  label: string
  value: string
  valueId: string
  onRemove: () => void
  onChange?: (newId: string) => void
  options?: FilterOption[]
}

interface UsersActiveFiltersBarProps {
  filters: UsersFilters
  onFiltersChange: (updates: Partial<UsersFilters>) => void
  onClearFilters: () => void
}

type FilterCategory = 'verified' | 'date'

const FILTER_CATEGORIES: { key: FilterCategory; label: string; icon: typeof EnvelopeIcon }[] = [
  { key: 'verified', label: 'Email Status', icon: EnvelopeIcon },
  { key: 'date', label: 'Date Joined', icon: CalendarIcon },
]

function getDateFromDaysAgo(daysAgo: number): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString().split('T')[0]
}

const DATE_PRESETS = [
  { value: 'today', label: 'Today', daysAgo: 0 },
  { value: '7days', label: 'Last 7 days', daysAgo: 7 },
  { value: '30days', label: 'Last 30 days', daysAgo: 30 },
  { value: '90days', label: 'Last 90 days', daysAgo: 90 },
] as const

function AddFilterButton({
  onFiltersChange,
  filters,
}: {
  onFiltersChange: (updates: Partial<UsersFilters>) => void
  filters: UsersFilters
}) {
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<FilterCategory | null>(null)

  const closePopover = () => {
    setOpen(false)
    setActiveCategory(null)
  }

  const handleSelectVerified = (verified: boolean) => {
    onFiltersChange({ verified })
    closePopover()
  }

  const handleSelectDate = (preset: (typeof DATE_PRESETS)[number]) => {
    onFiltersChange({ dateFrom: getDateFromDaysAgo(preset.daysAgo) })
    closePopover()
  }

  // Hide categories that are already filtered
  const availableCategories = FILTER_CATEGORIES.filter((cat) => {
    if (cat.key === 'verified' && filters.verified !== undefined) return false
    if (cat.key === 'date' && filters.dateFrom) return false
    return true
  })

  if (availableCategories.length === 0) return null

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) setActiveCategory(null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5',
            'rounded-full text-xs',
            'border border-dashed border-border/50',
            'text-muted-foreground hover:text-foreground',
            'hover:border-border hover:bg-muted/30',
            'transition-colors'
          )}
        >
          <PlusIcon className="h-3 w-3" />
          Add filter
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-0">
        {activeCategory === null ? (
          <div className="py-1">
            {availableCategories.map((category) => {
              const Icon = category.icon
              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setActiveCategory(category.key)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-2.5 py-1.5',
                    'text-xs text-left',
                    'hover:bg-muted/50 transition-colors'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {category.label}
                  </span>
                  <ChevronRightIcon className="h-3 w-3 text-muted-foreground" />
                </button>
              )
            })}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-muted-foreground hover:text-foreground border-b border-border/50"
            >
              <ChevronRightIcon className="h-2.5 w-2.5 rotate-180" />
              Back
            </button>
            <div className="max-h-[250px] overflow-y-auto py-1">
              {activeCategory === 'verified' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleSelectVerified(true)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors"
                  >
                    Verified only
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectVerified(false)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors"
                  >
                    Unverified only
                  </button>
                </>
              )}

              {activeCategory === 'date' &&
                DATE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => handleSelectDate(preset)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function getFilterIcon(type: ActiveFilter['type']) {
  const icons = {
    verified: EnvelopeIcon,
    dateFrom: CalendarIcon,
    dateTo: CalendarIcon,
    dateRange: CalendarIcon,
  }
  return icons[type]
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function FilterChip({ type, label, value, valueId, onRemove, onChange, options }: ActiveFilter) {
  const Icon = getFilterIcon(type)
  const [open, setOpen] = useState(false)
  const hasOptions = options && options.length > 0 && onChange

  const handleSelect = (id: string) => {
    onChange?.(id)
    setOpen(false)
  }

  const chipContent = (
    <>
      <Icon className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </>
  )

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5',
        'rounded-full bg-muted/60 text-xs',
        'border border-border/30 hover:border-border/50',
        'transition-colors'
      )}
    >
      {hasOptions ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 hover:opacity-70 transition-opacity"
            >
              {chipContent}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-40 p-0">
            <div className="max-h-[250px] overflow-y-auto py-1">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSelect(option.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs transition-colors',
                    option.id === valueId ? 'bg-muted/50 font-medium' : 'hover:bg-muted/50'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <span className="inline-flex items-center gap-1">{chipContent}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          'ml-0.5 p-0.5 rounded-full',
          'hover:bg-foreground/10',
          'text-muted-foreground hover:text-foreground',
          'transition-colors'
        )}
        aria-label={`Remove ${label} ${value} filter`}
      >
        <XMarkIcon className="h-3 w-3" />
      </button>
    </div>
  )
}

function computeActiveFilters(
  filters: UsersFilters,
  onFiltersChange: (updates: Partial<UsersFilters>) => void
): ActiveFilter[] {
  const result: ActiveFilter[] = []

  // Verified filter with dropdown options
  const verifiedOptions: FilterOption[] = [
    { id: 'verified', label: 'Verified' },
    { id: 'unverified', label: 'Unverified' },
  ]

  if (filters.verified !== undefined) {
    result.push({
      key: 'verified',
      type: 'verified',
      label: 'Email:',
      value: filters.verified ? 'Verified' : 'Unverified',
      valueId: filters.verified ? 'verified' : 'unverified',
      options: verifiedOptions,
      onChange: (val) => onFiltersChange({ verified: val === 'verified' }),
      onRemove: () => onFiltersChange({ verified: undefined }),
    })
  }

  // Date range - dropdown with presets
  const dateOptions: FilterOption[] = DATE_PRESETS.map((p) => ({
    id: p.value,
    label: p.label,
  }))

  if (filters.dateFrom && filters.dateTo) {
    result.push({
      key: 'dateRange',
      type: 'dateRange',
      label: 'Joined:',
      value: `${formatDate(filters.dateFrom)} - ${formatDate(filters.dateTo)}`,
      valueId: 'custom',
      onRemove: () => onFiltersChange({ dateFrom: undefined, dateTo: undefined }),
    })
  } else if (filters.dateFrom) {
    // Try to match current date to a preset for display
    const matchedPreset = DATE_PRESETS.find(
      (p) => getDateFromDaysAgo(p.daysAgo) === filters.dateFrom
    )

    result.push({
      key: 'dateFrom',
      type: 'dateFrom',
      label: 'Joined:',
      value: matchedPreset ? matchedPreset.label : formatDate(filters.dateFrom),
      valueId: matchedPreset?.value || filters.dateFrom,
      options: dateOptions,
      onChange: (presetId) => {
        const preset = DATE_PRESETS.find((p) => p.value === presetId)
        if (preset) {
          onFiltersChange({ dateFrom: getDateFromDaysAgo(preset.daysAgo) })
        }
      },
      onRemove: () => onFiltersChange({ dateFrom: undefined }),
    })
  } else if (filters.dateTo) {
    result.push({
      key: 'dateTo',
      type: 'dateTo',
      label: 'To:',
      value: formatDate(filters.dateTo),
      valueId: filters.dateTo,
      onRemove: () => onFiltersChange({ dateTo: undefined }),
    })
  }

  return result
}

export function UsersActiveFiltersBar({
  filters,
  onFiltersChange,
  onClearFilters,
}: UsersActiveFiltersBarProps) {
  const activeFilters = useMemo(
    () => computeActiveFilters(filters, onFiltersChange),
    [filters, onFiltersChange]
  )

  if (activeFilters.length === 0) {
    return (
      <div className="flex items-center">
        <AddFilterButton onFiltersChange={onFiltersChange} filters={filters} />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {activeFilters.map(({ key, ...filterProps }) => (
        <FilterChip key={key} {...filterProps} />
      ))}

      <AddFilterButton onFiltersChange={onFiltersChange} filters={filters} />

      {activeFilters.length > 1 && (
        <button
          type="button"
          onClick={onClearFilters}
          className={cn(
            'text-xs text-muted-foreground hover:text-foreground',
            'px-2 py-1 rounded',
            'hover:bg-muted/50',
            'transition-colors'
          )}
        >
          Clear all
        </button>
      )}
    </div>
  )
}
