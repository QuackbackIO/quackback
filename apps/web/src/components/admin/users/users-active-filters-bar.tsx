import { useMemo, useState } from 'react'
import {
  EnvelopeIcon,
  CalendarIcon,
  PlusIcon,
  ChevronRightIcon,
  GlobeAltIcon,
  DocumentTextIcon,
  HandThumbUpIcon,
  ChatBubbleLeftIcon,
  AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FilterChip, type FilterOption } from '@/components/shared/filter-chip'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useUserAttributes } from '@/lib/client/hooks/use-user-attributes-queries'
import type { UsersFilters } from '@/lib/shared/types'

interface ActiveFilter {
  key: string
  type: string
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

type FilterCategory =
  | 'verified'
  | 'date'
  | 'emailDomain'
  | 'postCount'
  | 'voteCount'
  | 'commentCount'
  | 'customAttr'

interface FilterCategoryDef {
  key: FilterCategory
  label: string
  icon: typeof EnvelopeIcon
}

const FILTER_CATEGORIES: FilterCategoryDef[] = [
  { key: 'verified', label: 'Email Status', icon: EnvelopeIcon },
  { key: 'emailDomain', label: 'Email Domain', icon: GlobeAltIcon },
  { key: 'date', label: 'Date Joined', icon: CalendarIcon },
  { key: 'postCount', label: 'Post Count', icon: DocumentTextIcon },
  { key: 'voteCount', label: 'Vote Count', icon: HandThumbUpIcon },
  { key: 'commentCount', label: 'Comment Count', icon: ChatBubbleLeftIcon },
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

const ACTIVITY_OPERATORS = [
  { value: 'gte', label: 'at least' },
  { value: 'gt', label: 'more than' },
  { value: 'lte', label: 'at most' },
  { value: 'lt', label: 'less than' },
  { value: 'eq', label: 'exactly' },
]

function parseActivityValue(raw?: string): { op: string; value: string } | null {
  if (!raw) return null
  const [op, val] = raw.split(':')
  if (!op || val === undefined) return null
  return { op, value: val }
}

function formatActivityValue(op: string, value: string): string {
  const opLabel = ACTIVITY_OPERATORS.find((o) => o.value === op)?.label ?? op
  return `${opLabel} ${value}`
}

function ActivityFilterInput({
  onApply,
  onClose,
}: {
  onApply: (opValue: string) => void
  onClose: () => void
}) {
  const [op, setOp] = useState('gte')
  const [value, setValue] = useState('')

  return (
    <div className="p-2 space-y-2">
      <Select value={op} onValueChange={setOp}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACTIVITY_OPERATORS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        className="h-7 text-xs"
        placeholder="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value) {
            onApply(`${op}:${value}`)
            onClose()
          }
        }}
      />
      <Button
        size="sm"
        className="w-full h-7 text-xs"
        disabled={!value}
        onClick={() => {
          if (value) {
            onApply(`${op}:${value}`)
            onClose()
          }
        }}
      >
        Apply
      </Button>
    </div>
  )
}

function TextFilterInput({
  placeholder,
  onApply,
  onClose,
}: {
  placeholder: string
  onApply: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')

  return (
    <div className="p-2 space-y-2">
      <Input
        className="h-7 text-xs"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            onApply(value.trim())
            onClose()
          }
        }}
        autoFocus
      />
      <Button
        size="sm"
        className="w-full h-7 text-xs"
        disabled={!value.trim()}
        onClick={() => {
          if (value.trim()) {
            onApply(value.trim())
            onClose()
          }
        }}
      >
        Apply
      </Button>
    </div>
  )
}

function CustomAttrFilterInput({
  attrKey,
  attrType,
  onApply,
  onClose,
}: {
  attrKey: string
  attrType: string
  onApply: (encoded: string) => void
  onClose: () => void
}) {
  const isNumeric = attrType === 'number' || attrType === 'currency' || attrType === 'date'
  const isBool = attrType === 'boolean'

  const [op, setOp] = useState(isNumeric ? 'gte' : isBool ? 'eq' : 'eq')
  const [value, setValue] = useState(isBool ? 'true' : '')

  const operators = isNumeric
    ? ACTIVITY_OPERATORS
    : isBool
      ? [{ value: 'eq', label: 'is' }]
      : [
          { value: 'eq', label: 'equals' },
          { value: 'neq', label: 'not equals' },
          { value: 'contains', label: 'contains' },
          { value: 'is_set', label: 'is set' },
          { value: 'is_not_set', label: 'is not set' },
        ]

  const isPresenceOp = op === 'is_set' || op === 'is_not_set'

  const handleApply = () => {
    const v = isPresenceOp ? '' : value
    onApply(`${attrKey}:${op}:${v}`)
    onClose()
  }

  return (
    <div className="p-2 space-y-2">
      <Select value={op} onValueChange={setOp}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!isPresenceOp &&
        (isBool ? (
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true" className="text-xs">
                True
              </SelectItem>
              <SelectItem value="false" className="text-xs">
                False
              </SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            type={isNumeric ? 'number' : 'text'}
            className="h-7 text-xs"
            placeholder={isNumeric ? '0' : 'value'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleApply()
            }}
          />
        ))}
      <Button
        size="sm"
        className="w-full h-7 text-xs"
        disabled={!isPresenceOp && !value.trim()}
        onClick={handleApply}
      >
        Apply
      </Button>
    </div>
  )
}

function AddFilterButton({
  onFiltersChange,
  filters,
}: {
  onFiltersChange: (updates: Partial<UsersFilters>) => void
  filters: UsersFilters
}) {
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<FilterCategory | null>(null)
  const [activeCustomAttr, setActiveCustomAttr] = useState<{
    key: string
    label: string
    type: string
  } | null>(null)

  const { data: userAttributes } = useUserAttributes()

  const closePopover = () => {
    setOpen(false)
    setActiveCategory(null)
    setActiveCustomAttr(null)
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
    if (cat.key === 'emailDomain' && filters.emailDomain) return false
    if (cat.key === 'postCount' && filters.postCount) return false
    if (cat.key === 'voteCount' && filters.voteCount) return false
    if (cat.key === 'commentCount' && filters.commentCount) return false
    return true
  })

  // Custom attributes not already in customAttrs filter
  const existingCustomKeys = new Set(
    (filters.customAttrs ?? '')
      .split(',')
      .filter(Boolean)
      .map((part) => part.split(':')[0])
  )
  const availableCustomAttrs = (userAttributes ?? []).filter(
    (attr) => !existingCustomKeys.has(attr.key)
  )

  const hasAvailableFilters = availableCategories.length > 0 || availableCustomAttrs.length > 0

  if (!hasAvailableFilters) return null

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) {
          setActiveCategory(null)
          setActiveCustomAttr(null)
        }
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
      <PopoverContent align="start" className="w-52 p-0">
        {activeCustomAttr ? (
          <div>
            <button
              type="button"
              onClick={() => setActiveCustomAttr(null)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-muted-foreground hover:text-foreground border-b border-border/50"
            >
              <ChevronRightIcon className="h-2.5 w-2.5 rotate-180" />
              {activeCustomAttr.label}
            </button>
            <CustomAttrFilterInput
              attrKey={activeCustomAttr.key}
              attrType={activeCustomAttr.type}
              onApply={(encoded) => {
                const existing = filters.customAttrs
                const newVal = existing ? `${existing},${encoded}` : encoded
                onFiltersChange({ customAttrs: newVal })
              }}
              onClose={closePopover}
            />
          </div>
        ) : activeCategory === null ? (
          <div className="py-1 max-h-[350px] overflow-y-auto">
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
            {availableCustomAttrs.length > 0 && (
              <>
                <div className="border-b border-border/30 my-1" />
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Custom attributes
                </div>
                {availableCustomAttrs.map((attr) => (
                  <button
                    key={attr.key}
                    type="button"
                    onClick={() =>
                      setActiveCustomAttr({ key: attr.key, label: attr.label, type: attr.type })
                    }
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-2.5 py-1.5',
                      'text-xs text-left',
                      'hover:bg-muted/50 transition-colors'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <AdjustmentsHorizontalIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {attr.label}
                    </span>
                    <ChevronRightIcon className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))}
              </>
            )}
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
            <div className="max-h-[250px] overflow-y-auto">
              {activeCategory === 'verified' && (
                <div className="py-1">
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
                </div>
              )}

              {activeCategory === 'date' && (
                <div className="py-1">
                  {DATE_PRESETS.map((preset) => (
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
              )}

              {activeCategory === 'emailDomain' && (
                <TextFilterInput
                  placeholder="example.com"
                  onApply={(value) => onFiltersChange({ emailDomain: value })}
                  onClose={closePopover}
                />
              )}

              {activeCategory === 'postCount' && (
                <ActivityFilterInput
                  onApply={(value) => onFiltersChange({ postCount: value })}
                  onClose={closePopover}
                />
              )}

              {activeCategory === 'voteCount' && (
                <ActivityFilterInput
                  onApply={(value) => onFiltersChange({ voteCount: value })}
                  onClose={closePopover}
                />
              )}

              {activeCategory === 'commentCount' && (
                <ActivityFilterInput
                  onApply={(value) => onFiltersChange({ commentCount: value })}
                  onClose={closePopover}
                />
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function getFilterIcon(type: string) {
  const icons: Record<string, typeof EnvelopeIcon> = {
    verified: EnvelopeIcon,
    dateFrom: CalendarIcon,
    dateTo: CalendarIcon,
    dateRange: CalendarIcon,
    emailDomain: GlobeAltIcon,
    postCount: DocumentTextIcon,
    voteCount: HandThumbUpIcon,
    commentCount: ChatBubbleLeftIcon,
    customAttr: AdjustmentsHorizontalIcon,
  }
  return icons[type] ?? AdjustmentsHorizontalIcon
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function computeActiveFilters(
  filters: UsersFilters,
  onFiltersChange: (updates: Partial<UsersFilters>) => void
): ActiveFilter[] {
  const result: ActiveFilter[] = []

  // Verified filter
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

  // Email domain filter
  if (filters.emailDomain) {
    result.push({
      key: 'emailDomain',
      type: 'emailDomain',
      label: 'Domain:',
      value: filters.emailDomain,
      valueId: filters.emailDomain,
      onRemove: () => onFiltersChange({ emailDomain: undefined }),
    })
  }

  // Date range
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

  // Activity count filters
  for (const [filterKey, filterLabel] of [
    ['postCount', 'Posts:'],
    ['voteCount', 'Votes:'],
    ['commentCount', 'Comments:'],
  ] as const) {
    const parsed = parseActivityValue(filters[filterKey])
    if (parsed) {
      result.push({
        key: filterKey,
        type: filterKey,
        label: filterLabel,
        value: formatActivityValue(parsed.op, parsed.value),
        valueId: filterKey,
        onRemove: () => onFiltersChange({ [filterKey]: undefined }),
      })
    }
  }

  // Custom attribute filters
  if (filters.customAttrs) {
    const parts = filters.customAttrs.split(',').filter(Boolean)
    for (const part of parts) {
      const [key, op, ...rest] = part.split(':')
      if (!key || !op) continue
      const value = rest.join(':')
      const OP_LABELS: Record<string, string> = {
        eq: 'equals',
        neq: 'not equals',
        contains: 'contains',
        starts_with: 'starts with',
        ends_with: 'ends with',
        is_set: 'is set',
        is_not_set: 'is not set',
        gt: 'more than',
        gte: 'at least',
        lt: 'less than',
        lte: 'at most',
      }
      const opLabel = OP_LABELS[op] ?? op
      const displayValue = op === 'is_set' || op === 'is_not_set' ? opLabel : `${opLabel} ${value}`

      result.push({
        key: `custom_${key}`,
        type: 'customAttr',
        label: `${key}:`,
        value: displayValue,
        valueId: key,
        onRemove: () => {
          const remaining = parts.filter((p) => !p.startsWith(`${key}:`)).join(',')
          onFiltersChange({ customAttrs: remaining || undefined })
        },
      })
    }
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
    <div className="flex flex-wrap gap-1 items-center">
      {activeFilters.map(({ key, type, ...filterProps }) => (
        <FilterChip key={key} icon={getFilterIcon(type)} {...filterProps} />
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
