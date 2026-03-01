import { SearchInput } from '@/components/shared/search-input'
import { cn } from '@/lib/shared/utils'

interface SortOption {
  value: string
  label: string
}

interface AdminListHeaderProps {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  sortOptions?: SortOption[]
  activeSort?: string
  onSortChange?: (value: string) => void
  /** Slot for action buttons (e.g., create button) placed after sort pills */
  action?: React.ReactNode
  /** Additional rows below the search bar (e.g., active filters bar) */
  children?: React.ReactNode
}

export function AdminListHeader({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  sortOptions,
  activeSort,
  onSortChange,
  action,
  children,
}: AdminListHeaderProps) {
  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2.5">
      <div className="flex items-center gap-2">
        <SearchInput
          value={searchValue}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          data-search-input
        />
        {sortOptions && onSortChange && (
          <div className="flex items-center gap-1">
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs transition-colors cursor-pointer whitespace-nowrap',
                  activeSort === opt.value
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/50'
                )}
                onClick={() => onSortChange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {action}
      </div>
      {children}
    </div>
  )
}
