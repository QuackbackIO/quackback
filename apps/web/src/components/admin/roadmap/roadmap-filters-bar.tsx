import { useMemo, useState, useEffect } from 'react'
import {
  Squares2X2Icon,
  TagIcon,
  UserGroupIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ChevronRightIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FilterChip, type FilterOption } from '@/components/shared/filter-chip'
import type { RoadmapFilters } from '@/lib/shared/types'
import type { Tag } from '@/lib/shared/db-types'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal board shape needed by the filter bar (works for both admin Board and public board). */
interface FilterBarBoard {
  id: string
  name: string
}

export interface RoadmapFiltersBarProps {
  filters: RoadmapFilters
  onFiltersChange: (updates: Partial<RoadmapFilters>) => void
  onClearAll: () => void
  boards: FilterBarBoard[]
  tags: Tag[]
  segments?: SegmentListItem[]
  onToggleBoard: (id: string) => void
  onToggleTag: (id: string) => void
  onToggleSegment?: (id: string) => void
}

type FilterCategory = 'board' | 'tags' | 'segment'
type IconComponent = React.ComponentType<{ className?: string }>

type RoadmapFilterType = 'board' | 'tags' | 'segment' | 'search'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SORT_OPTIONS = [
  { value: 'votes' as const, label: 'Votes' },
  { value: 'newest' as const, label: 'Newest' },
  { value: 'oldest' as const, label: 'Oldest' },
]

const FILTER_ICON_MAP: Record<RoadmapFilterType, IconComponent> = {
  board: Squares2X2Icon,
  tags: TagIcon,
  segment: UserGroupIcon,
  search: MagnifyingGlassIcon,
}

const FILTER_CATEGORIES: { key: FilterCategory; label: string; icon: IconComponent }[] = [
  { key: 'board', label: 'Board', icon: Squares2X2Icon },
  { key: 'tags', label: 'Tag', icon: TagIcon },
  { key: 'segment', label: 'Segment', icon: UserGroupIcon },
]

const MENU_BUTTON_STYLES =
  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors'

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

function MenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={MENU_BUTTON_STYLES}>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// computeActiveFilters
// ---------------------------------------------------------------------------

interface ActiveFilter {
  key: string
  type: RoadmapFilterType
  label: string
  value: string
  valueId: string
  color?: string
  onRemove: () => void
  onChange?: (newId: string) => void
  options?: FilterOption[]
}

function computeActiveFilters(
  filters: RoadmapFilters,
  boards: FilterBarBoard[],
  tags: Tag[],
  segments: SegmentListItem[] | undefined,
  onFiltersChange: (updates: Partial<RoadmapFilters>) => void
): ActiveFilter[] {
  const result: ActiveFilter[] = []

  if (filters.search) {
    result.push({
      key: 'search',
      type: 'search',
      label: 'Search:',
      value: filters.search,
      valueId: 'search',
      onRemove: () => onFiltersChange({ search: undefined }),
    })
  }

  if (filters.board?.length) {
    const boardOptions: FilterOption[] = boards.map((b) => ({ id: b.id, label: b.name }))
    for (const id of filters.board) {
      const board = boards.find((b) => b.id === id)
      if (!board) continue
      result.push({
        key: `board-${id}`,
        type: 'board',
        label: 'Board:',
        value: board.name,
        valueId: id,
        options: boardOptions,
        onChange: (newId) => {
          const others = filters.board?.filter((b) => b !== id) ?? []
          onFiltersChange({ board: [...others, newId] })
        },
        onRemove: () => {
          const remaining = filters.board?.filter((b) => b !== id)
          onFiltersChange({ board: remaining?.length ? remaining : undefined })
        },
      })
    }
  }

  if (filters.tags?.length) {
    const tagOptions: FilterOption[] = tags.map((t) => ({ id: t.id, label: t.name }))
    for (const id of filters.tags) {
      const tag = tags.find((t) => t.id === id)
      if (!tag) continue
      result.push({
        key: `tag-${id}`,
        type: 'tags',
        label: 'Tag:',
        value: tag.name,
        valueId: id,
        options: tagOptions,
        onChange: (newId) => {
          const others = filters.tags?.filter((t) => t !== id) ?? []
          onFiltersChange({ tags: [...others, newId] })
        },
        onRemove: () => {
          const remaining = filters.tags?.filter((t) => t !== id)
          onFiltersChange({ tags: remaining?.length ? remaining : undefined })
        },
      })
    }
  }

  if (filters.segmentIds?.length && segments) {
    const segmentOptions: FilterOption[] = segments.map((s) => ({
      id: s.id,
      label: s.name,
      color: s.color,
    }))
    for (const id of filters.segmentIds) {
      const segment = segments.find((s) => s.id === id)
      if (!segment) continue
      result.push({
        key: `segment-${id}`,
        type: 'segment',
        label: 'Segment:',
        value: segment.name,
        valueId: id,
        color: segment.color,
        options: segmentOptions,
        onChange: (newId) => {
          const others = filters.segmentIds?.filter((s) => s !== id) ?? []
          onFiltersChange({ segmentIds: [...others, newId] })
        },
        onRemove: () => {
          const remaining = filters.segmentIds?.filter((s) => s !== id)
          onFiltersChange({ segmentIds: remaining?.length ? remaining : undefined })
        },
      })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// AddFilterButton
// ---------------------------------------------------------------------------

function AddFilterButton({
  boards,
  tags,
  segments,
  onToggleBoard,
  onToggleTag,
  onToggleSegment,
}: {
  boards: FilterBarBoard[]
  tags: Tag[]
  segments?: SegmentListItem[]
  onToggleBoard: (id: string) => void
  onToggleTag: (id: string) => void
  onToggleSegment?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<FilterCategory | null>(null)

  const closePopover = () => {
    setOpen(false)
    setActiveCategory(null)
  }

  // Build the visible categories: hide segment when unavailable
  const visibleCategories = FILTER_CATEGORIES.filter((cat) => {
    if (cat.key === 'segment') {
      return onToggleSegment && segments && segments.length > 0
    }
    return true
  })

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) setActiveCategory(null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5',
            'rounded-full text-xs',
            'border border-dashed border-border/50',
            'text-muted-foreground hover:text-foreground',
            'hover:border-border hover:bg-muted/30',
            'transition-colors'
          )}
        >
          <PlusIcon className="h-3 w-3" />
          Add filter
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-0">
        {activeCategory === null ? (
          <div className="py-1">
            {visibleCategories.map((category) => {
              const Icon = category.icon
              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setActiveCategory(category.key)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-2.5 py-1.5',
                    'text-xs text-left',
                    'hover:bg-muted/50 transition-colors'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {category.label}
                  </span>
                  <ChevronRightIcon className="h-3 w-3 text-muted-foreground" />
                </button>
              )
            })}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground border-b border-border/50"
            >
              <ChevronRightIcon className="h-2.5 w-2.5 rotate-180" />
              Back
            </button>
            <div className="max-h-[250px] overflow-y-auto py-1">
              {activeCategory === 'board' &&
                boards.map((board) => (
                  <MenuButton
                    key={board.id}
                    onClick={() => {
                      onToggleBoard(board.id)
                      closePopover()
                    }}
                  >
                    {board.name}
                  </MenuButton>
                ))}

              {activeCategory === 'tags' &&
                tags.map((tag) => (
                  <MenuButton
                    key={tag.id}
                    onClick={() => {
                      onToggleTag(tag.id)
                      closePopover()
                    }}
                  >
                    {tag.name}
                  </MenuButton>
                ))}

              {activeCategory === 'segment' &&
                segments?.map((segment) => (
                  <MenuButton
                    key={segment.id}
                    onClick={() => {
                      onToggleSegment?.(segment.id)
                      closePopover()
                    }}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: segment.color }}
                    />
                    {segment.name}
                  </MenuButton>
                ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// RoadmapFiltersBar (unified for admin and public)
// ---------------------------------------------------------------------------

export function RoadmapFiltersBar({
  filters,
  onFiltersChange,
  onClearAll,
  boards,
  tags,
  segments,
  onToggleBoard,
  onToggleTag,
  onToggleSegment,
}: RoadmapFiltersBarProps) {
  const [searchValue, setSearchValue] = useState(filters.search || '')
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    setSearchValue(filters.search || '')
  }, [filters.search])

  const activeFilters = useMemo(
    () => computeActiveFilters(filters, boards, tags, segments, onFiltersChange),
    [filters, boards, tags, segments, onFiltersChange]
  )

  const handleSearchSubmit = () => {
    onFiltersChange({ search: searchValue.trim() || undefined })
    setSearchOpen(false)
  }

  const currentSort = filters.sort ?? 'votes'

  return (
    <div className="flex flex-col gap-1.5">
      {/* Search and sort row */}
      <div className="flex items-center gap-2">
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors',
                filters.search
                  ? 'bg-foreground/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <MagnifyingGlassIcon className="h-3.5 w-3.5" />
              {filters.search || 'Search'}
              {filters.search && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onFiltersChange({ search: undefined })
                  }}
                  className="ml-0.5 hover:text-foreground"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleSearchSubmit()
              }}
            >
              <input
                type="text"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Search posts..."
                className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </form>
          </PopoverContent>
        </Popover>

        <div className="h-4 w-px bg-border/50" />

        <div className="flex items-center gap-0.5">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onFiltersChange({ sort: opt.value })}
              className={cn(
                'px-2 py-1 rounded-md text-xs transition-colors',
                currentSort === opt.value
                  ? 'bg-foreground/10 text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active filters + add button */}
      <div className="flex flex-wrap gap-1 items-center">
        {activeFilters.map(({ key, type, ...filterProps }) => (
          <FilterChip key={key} icon={FILTER_ICON_MAP[type]} {...filterProps} />
        ))}

        <AddFilterButton
          boards={boards}
          tags={tags}
          segments={segments}
          onToggleBoard={onToggleBoard}
          onToggleTag={onToggleTag}
          onToggleSegment={onToggleSegment}
        />

        {activeFilters.length > 1 && (
          <button
            type="button"
            onClick={onClearAll}
            className={cn(
              'text-[11px] text-muted-foreground hover:text-foreground',
              'px-1.5 py-0.5 rounded',
              'hover:bg-muted/50',
              'transition-colors'
            )}
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  )
}
