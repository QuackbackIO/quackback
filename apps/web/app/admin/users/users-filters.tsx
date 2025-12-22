'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { UsersFilters } from './use-users-filters'

interface UsersFiltersProps {
  filters: UsersFilters
  onFiltersChange: (updates: Partial<UsersFilters>) => void
  onClearFilters: () => void
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
    <div className="border-b border-border/30 pb-4 last:border-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {title}
        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {isOpen && <div className="mt-3">{children}</div>}
    </div>
  )
}

export function UsersFiltersPanel({ filters, onFiltersChange, onClearFilters }: UsersFiltersProps) {
  const handleVerifiedChange = (value: string) => {
    if (value === 'all') {
      onFiltersChange({ verified: undefined })
    } else {
      onFiltersChange({ verified: value === 'verified' })
    }
  }

  const verifiedValue =
    filters.verified === undefined ? 'all' : filters.verified ? 'verified' : 'unverified'

  const hasActiveFilters = !!(
    filters.search ||
    filters.verified !== undefined ||
    filters.dateFrom ||
    filters.dateTo
  )

  return (
    <div className="space-y-4">
      {/* Clear Filters */}
      {hasActiveFilters && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3 mr-1" />
            Clear filters
          </Button>
        </div>
      )}

      {/* Email Verified Filter */}
      <FilterSection title="Email Verified">
        <RadioGroup value={verifiedValue} onValueChange={handleVerifiedChange}>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="all" id="verified-all" />
              <Label htmlFor="verified-all" className="text-sm font-normal cursor-pointer">
                All users
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="verified" id="verified-yes" />
              <Label htmlFor="verified-yes" className="text-sm font-normal cursor-pointer">
                Verified only
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="unverified" id="verified-no" />
              <Label htmlFor="verified-no" className="text-sm font-normal cursor-pointer">
                Unverified only
              </Label>
            </div>
          </div>
        </RadioGroup>
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
              className="mt-1"
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
              className="mt-1"
            />
          </div>
        </div>
      </FilterSection>
    </div>
  )
}
