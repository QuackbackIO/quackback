import { cn } from '@/lib/utils'

interface SingleSelectFilterListProps<T extends { id: string; name: string }> {
  items: T[]
  selectedId: string | undefined
  onSelect: (id: string | undefined) => void
  renderItem?: (item: T, isSelected: boolean) => React.ReactNode
  className?: string
}

export function SingleSelectFilterList<T extends { id: string; name: string }>({
  items,
  selectedId,
  onSelect,
  renderItem,
  className,
}: SingleSelectFilterListProps<T>) {
  const handleClick = (id: string) => {
    // Click same item = deselect (show all)
    // Click different item = select that one
    onSelect(selectedId === id ? undefined : id)
  }

  return (
    <div className={cn('space-y-0.5', className)} role="listbox" aria-label="Filter selection">
      {items.map((item) => {
        const isSelected = selectedId === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => handleClick(item.id)}
            className={cn(
              'w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors',
              isSelected
                ? 'bg-muted/50 text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
            )}
          >
            {renderItem ? renderItem(item, isSelected) : item.name}
          </button>
        )
      })}
    </div>
  )
}

// Specialized component for status filtering with color dots
interface StatusFilterListProps {
  statuses: Array<{ id: string; slug: string; name: string; color: string }>
  selectedSlug: string | undefined
  onSelect: (slug: string | undefined) => void
}

export function StatusFilterList({ statuses, selectedSlug, onSelect }: StatusFilterListProps) {
  // Map statuses to use slug as id for the generic component
  const items = statuses.map((s) => ({ id: s.slug, name: s.name, color: s.color }))

  return (
    <SingleSelectFilterList
      items={items}
      selectedId={selectedSlug}
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

// Specialized component for board filtering
interface BoardFilterListProps {
  boards: Array<{ id: string; name: string }>
  selectedId: string | undefined
  onSelect: (id: string | undefined) => void
}

export function BoardFilterList({ boards, selectedId, onSelect }: BoardFilterListProps) {
  return (
    <SingleSelectFilterList
      items={boards}
      selectedId={selectedId}
      onSelect={onSelect}
      renderItem={(board) => <span className="truncate">{board.name}</span>}
    />
  )
}
