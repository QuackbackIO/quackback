import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/shared/utils'
import type { UsersFilters } from '@/components/admin/users/use-users-filters'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'

interface UsersFiltersProps {
  filters: UsersFilters
  onFiltersChange: (updates: Partial<UsersFilters>) => void
}

function FilterSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="pb-4 last:pb-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {title}
        {isOpen ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
      </button>
      {isOpen && <div className="mt-2">{children}</div>}
    </div>
  )
}

interface FilterOptionProps {
  label: string
  isSelected: boolean
  onClick: () => void
  count?: number
  color?: string
  isDynamic?: boolean
}

function FilterOption({ label, isSelected, onClick, count, color, isDynamic }: FilterOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-2',
        isSelected
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      {color && (
        <span
          className="h-2 w-2 rounded-full shrink-0 ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="flex-1 truncate">{label}</span>
      {isDynamic && (
        <span className="text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wide shrink-0">
          auto
        </span>
      )}
      {count !== undefined && (
        <span className="text-[10px] text-muted-foreground/60 shrink-0">{count}</span>
      )}
    </button>
  )
}

function SegmentsFilterSection({
  filters,
  onFiltersChange,
}: {
  filters: UsersFilters
  onFiltersChange: (updates: Partial<UsersFilters>) => void
}) {
  const { data: segments, isLoading } = useSegments()

  if (isLoading) {
    return (
      <FilterSection title="Segments">
        <div className="space-y-1">
          {[1, 2].map((i) => (
            <div key={i} className="h-7 bg-muted/30 rounded-md animate-pulse" />
          ))}
        </div>
      </FilterSection>
    )
  }

  if (!segments || segments.length === 0) {
    return (
      <FilterSection title="Segments" defaultOpen={false}>
        <p className="text-xs text-muted-foreground px-2.5 py-1.5">No segments yet.</p>
      </FilterSection>
    )
  }

  const selectedIds = filters.segmentIds ?? []

  const handleToggle = (segmentId: string) => {
    const isSelected = selectedIds.includes(segmentId)
    const newIds = isSelected
      ? selectedIds.filter((id) => id !== segmentId)
      : [...selectedIds, segmentId]
    onFiltersChange({ segmentIds: newIds.length > 0 ? newIds : undefined })
  }

  return (
    <FilterSection title="Segments">
      <div className="space-y-1">
        {segments.map((seg) => (
          <FilterOption
            key={seg.id}
            label={seg.name}
            isSelected={selectedIds.includes(seg.id)}
            onClick={() => handleToggle(seg.id)}
            count={seg.memberCount}
            color={seg.color}
            isDynamic={seg.type === 'dynamic'}
          />
        ))}
      </div>
    </FilterSection>
  )
}

export function UsersFiltersPanel({ filters, onFiltersChange }: UsersFiltersProps) {
  const handleVerifiedClick = (value: boolean) => {
    const isCurrentlySelected = filters.verified === value
    onFiltersChange({ verified: isCurrentlySelected ? undefined : value })
  }

  return (
    <div className="space-y-0">
      {/* Segments Filter */}
      <SegmentsFilterSection filters={filters} onFiltersChange={onFiltersChange} />

      {/* Email Verified Filter */}
      <FilterSection title="Email Status">
        <div className="space-y-1">
          <FilterOption
            label="Verified"
            isSelected={filters.verified === true}
            onClick={() => handleVerifiedClick(true)}
          />
          <FilterOption
            label="Unverified"
            isSelected={filters.verified === false}
            onClick={() => handleVerifiedClick(false)}
          />
        </div>
      </FilterSection>

      {/* Date Joined Filter */}
      <FilterSection title="Date Joined" defaultOpen={false}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="date-from" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id="date-from"
              type="date"
              value={filters.dateFrom || ''}
              onChange={(e) => onFiltersChange({ dateFrom: e.target.value || undefined })}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="date-to" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="date-to"
              type="date"
              value={filters.dateTo || ''}
              onChange={(e) => onFiltersChange({ dateTo: e.target.value || undefined })}
              className="mt-1.5"
            />
          </div>
        </div>
      </FilterSection>
    </div>
  )
}
