'use client'

import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/solid'
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
                  'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                  isSelected
                    ? 'bg-muted text-foreground'
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
