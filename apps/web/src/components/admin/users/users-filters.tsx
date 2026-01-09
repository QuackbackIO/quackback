import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { UsersFilters } from '@/components/admin/users/use-users-filters'

interface UsersFiltersProps {
  filters: UsersFilters
  onFiltersChange: (updates: Partial<UsersFilters>) => void
  onClearFilters: () => void
  hasActiveFilters?: boolean
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
}

function FilterOption({ label, isSelected, onClick }: FilterOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
        isSelected
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      {label}
    </button>
  )
}

export function UsersFiltersPanel({
  filters,
  onFiltersChange,
  onClearFilters,
  hasActiveFilters = false,
}: UsersFiltersProps) {
  const handleVerifiedChange = (value: 'all' | 'verified' | 'unverified') => {
    if (value === 'all') {
      onFiltersChange({ verified: undefined })
    } else {
      onFiltersChange({ verified: value === 'verified' })
    }
  }

  // Determine which option is currently selected
  let verifiedValue: 'all' | 'verified' | 'unverified' = 'all'
  if (filters.verified === true) {
    verifiedValue = 'verified'
  } else if (filters.verified === false) {
    verifiedValue = 'unverified'
  }

  return (
    <div className="space-y-1">
      {/* Clear Filters */}
      {hasActiveFilters && (
        <div className="flex justify-end pb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="text-xs text-muted-foreground hover:text-foreground -mr-2"
          >
            <XMarkIcon className="h-3.5 w-3.5 mr-1" />
            Clear filters
          </Button>
        </div>
      )}

      {/* Email Verified Filter */}
      <FilterSection title="Email Status">
        <div className="space-y-1">
          <FilterOption
            label="All users"
            isSelected={verifiedValue === 'all'}
            onClick={() => handleVerifiedChange('all')}
          />
          <FilterOption
            label="Verified only"
            isSelected={verifiedValue === 'verified'}
            onClick={() => handleVerifiedChange('verified')}
          />
          <FilterOption
            label="Unverified only"
            isSelected={verifiedValue === 'unverified'}
            onClick={() => handleVerifiedChange('unverified')}
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
