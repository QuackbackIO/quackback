import { XMarkIcon } from '@heroicons/react/16/solid'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/shared/utils'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import type { HelpCenterStatusFilter } from './use-help-center-filters'

interface HelpCenterActiveFiltersBarProps {
  status: HelpCenterStatusFilter
  search?: string
  category?: string
  showDeleted?: boolean
  onClearStatus: () => void
  onClearSearch: () => void
  onClearCategory: () => void
  onClearShowDeleted: () => void
  onClearAll: () => void
}

interface Chip {
  key: string
  label: string
  onRemove: () => void
}

export function HelpCenterActiveFiltersBar({
  status,
  search,
  category,
  showDeleted,
  onClearStatus,
  onClearSearch,
  onClearCategory,
  onClearShowDeleted,
  onClearAll,
}: HelpCenterActiveFiltersBarProps) {
  const { data: categories } = useQuery(helpCenterQueries.categories())
  const categoryName = category
    ? (categories?.find((c) => c.id === category)?.name ?? 'Category')
    : null

  const chips: Chip[] = []

  if (status && status !== 'all') {
    chips.push({
      key: 'status',
      label: `Status: ${status === 'draft' ? 'Draft' : 'Published'}`,
      onRemove: onClearStatus,
    })
  }
  if (search?.trim()) {
    chips.push({
      key: 'search',
      label: `Search: "${search}"`,
      onRemove: onClearSearch,
    })
  }
  if (categoryName) {
    chips.push({
      key: 'category',
      label: `Category: ${categoryName}`,
      onRemove: onClearCategory,
    })
  }
  if (showDeleted) {
    chips.push({
      key: 'deleted',
      label: 'Showing deleted',
      onRemove: onClearShowDeleted,
    })
  }

  if (chips.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          className={cn(
            'group inline-flex items-center gap-1 rounded-full px-2 py-0.5',
            'bg-muted text-xs text-foreground/80',
            'hover:bg-muted/70 transition-colors'
          )}
        >
          <span>{chip.label}</span>
          <XMarkIcon className="h-3 w-3 text-muted-foreground group-hover:text-foreground" />
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
