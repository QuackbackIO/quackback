import { cn } from '@/lib/shared/utils'
import { MENU_ROW } from '@/components/ui/menu'

interface FilterListProps<T extends { id: string; name: string }> {
  items: T[]
  selectedIds: string[]
  onSelect: (id: string, addToSelection: boolean) => void
  renderItem?: (item: T, isSelected: boolean) => React.ReactNode
  /** Per-item counts keyed by item id. Omitted while counts are loading. */
  counts?: Record<string, number>
  className?: string
}

function FilterCount({ count }: { count: number | undefined }) {
  if (count == null) return null
  return (
    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{count}</span>
  )
}

export function FilterList<T extends { id: string; name: string }>({
  items,
  selectedIds,
  onSelect,
  renderItem,
  counts,
  className,
}: FilterListProps<T>) {
  const handleClick = (id: string, event: React.MouseEvent) => {
    const addToSelection = event.metaKey || event.ctrlKey
    onSelect(id, addToSelection)
  }

  return (
    <div className={cn('space-y-1', className)} role="listbox" aria-label="Filter selection">
      {items.map((item) => {
        const isSelected = selectedIds.includes(item.id)
        const count = counts ? (counts[item.id] ?? 0) : undefined
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            aria-label={count == null ? item.name : `${item.name}, ${count}`}
            onClick={(e) => handleClick(item.id, e)}
            className={cn(
              MENU_ROW,
              'w-full',
              isSelected
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            {renderItem ? (
              renderItem(item, isSelected)
            ) : (
              <span className="min-w-0 flex-1 truncate text-left">{item.name}</span>
            )}
            <FilterCount count={count} />
          </button>
        )
      })}
    </div>
  )
}

// Specialized component for status filtering with color dots
interface StatusFilterListProps {
  statuses: Array<{ id: string; slug: string; name: string; color: string }>
  selectedSlugs: string[]
  onSelect: (slug: string, addToSelection: boolean) => void
  counts?: Record<string, number>
}

export function StatusFilterList({
  statuses,
  selectedSlugs,
  onSelect,
  counts,
}: StatusFilterListProps) {
  const items = statuses.map((s) => ({ id: s.slug, name: s.name, color: s.color }))

  return (
    <FilterList
      items={items}
      selectedIds={selectedSlugs}
      onSelect={onSelect}
      counts={counts}
      renderItem={(status) => (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: status.color }}
            aria-hidden="true"
          />
          <span className="truncate">{status.name}</span>
        </span>
      )}
    />
  )
}

// Specialized component for board filtering - uses default rendering
export function BoardFilterList({
  boards,
  selectedIds,
  onSelect,
  counts,
}: {
  boards: Array<{ id: string; name: string }>
  selectedIds: string[]
  onSelect: (id: string, addToSelection: boolean) => void
  counts?: Record<string, number>
}) {
  return <FilterList items={boards} selectedIds={selectedIds} onSelect={onSelect} counts={counts} />
}
