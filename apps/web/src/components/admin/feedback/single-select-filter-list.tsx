import { cn } from '@/lib/shared/utils'

interface FilterListProps<T extends { id: string; name: string }> {
  items: T[]
  selectedIds: string[]
  onSelect: (id: string, addToSelection: boolean) => void
  renderItem?: (item: T, isSelected: boolean) => React.ReactNode
  className?: string
}

export function FilterList<T extends { id: string; name: string }>({
  items,
  selectedIds,
  onSelect,
  renderItem,
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
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={(e) => handleClick(item.id, e)}
            className={cn(
              'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
              isSelected
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            {renderItem ? (
              renderItem(item, isSelected)
            ) : (
              <span className="truncate">{item.name}</span>
            )}
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
}

export function StatusFilterList({ statuses, selectedSlugs, onSelect }: StatusFilterListProps) {
  const items = statuses.map((s) => ({ id: s.slug, name: s.name, color: s.color }))

  return (
    <FilterList
      items={items}
      selectedIds={selectedSlugs}
      onSelect={onSelect}
      renderItem={(status) => (
        <span className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full shrink-0"
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
}: {
  boards: Array<{ id: string; name: string }>
  selectedIds: string[]
  onSelect: (id: string, addToSelection: boolean) => void
}) {
  return <FilterList items={boards} selectedIds={selectedIds} onSelect={onSelect} />
}
