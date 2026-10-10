import { SearchInput } from '@/components/shared/search-input'
import { SortMenu } from '@/components/shared/sort-menu'

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
  /** The sort trigger's text for the active option, for translated copy. */
  formatSortLabel?: (label: string) => React.ReactNode
  /** Filter controls placed after the sort menu */
  filters?: React.ReactNode
  /** Slot for the primary action (e.g., NewButton), on the right */
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
  formatSortLabel,
  filters,
  action,
  children,
}: AdminListHeaderProps) {
  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div data-slot="admin-list-search" className="flex min-w-[160px] max-w-[360px] flex-1">
          <SearchInput
            value={searchValue}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            data-search-input
          />
        </div>
        {sortOptions && sortOptions.length > 0 && onSortChange && (
          <SortMenu
            options={sortOptions}
            value={activeSort ?? sortOptions[0].value}
            onChange={onSortChange}
            formatLabel={formatSortLabel}
          />
        )}
        {filters}
        {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
      </div>
      {children}
    </div>
  )
}
