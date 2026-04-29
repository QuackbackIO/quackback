import { useMemo, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import {
  Squares2X2Icon,
  TagIcon,
  UserGroupIcon,
  PlusIcon,
  ChevronRightIcon,
  FunnelIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FilterChip, type FilterOption } from '@/components/shared/filter-chip'
import type { RoadmapFilters } from '@/lib/shared/types'
import type { Tag } from '@/lib/shared/db-types'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'

interface FilterBarBoard {
  id: string
  name: string
}

type FilterCategory = 'board' | 'tags' | 'segment'
type IconComponent = React.ComponentType<{ className?: string }>

const FILTER_ICON_MAP: Record<FilterCategory, IconComponent> = {
  board: Squares2X2Icon,
  tags: TagIcon,
  segment: UserGroupIcon,
}

interface PublicRoadmapFiltersBarProps {
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

export function PublicRoadmapFiltersBar({
  filters,
  onFiltersChange,
  onClearAll,
  boards,
  tags,
  segments,
  onToggleBoard,
  onToggleTag,
  onToggleSegment,
}: PublicRoadmapFiltersBarProps) {
  const intl = useIntl()

  const activeChips = useMemo(
    () => buildActiveChips({ filters, onFiltersChange, boards, tags, segments, intl }),
    [filters, onFiltersChange, boards, tags, segments, intl]
  )

  if (activeChips.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Active filters"
      className="flex flex-wrap gap-2 items-center py-0.5"
    >
      {activeChips.map(({ key, type, ...chipProps }) => (
        <FilterChip key={key} icon={FILTER_ICON_MAP[type]} {...chipProps} />
      ))}

      <AddFilterButton
        variant="pill"
        boards={boards}
        tags={tags}
        segments={segments}
        onToggleBoard={onToggleBoard}
        onToggleTag={onToggleTag}
        onToggleSegment={onToggleSegment}
      />

      {activeChips.length >= 2 && (
        <button
          type="button"
          onClick={onClearAll}
          className={cn(
            'text-xs text-muted-foreground hover:text-foreground',
            'px-2 py-1 rounded',
            'hover:bg-muted/50',
            'transition-colors'
          )}
        >
          <FormattedMessage id="portal.feedback.filter.clearAll" defaultMessage="Clear all" />
        </button>
      )}
    </div>
  )
}

interface AddFilterButtonProps {
  boards: FilterBarBoard[]
  tags: Tag[]
  segments?: SegmentListItem[]
  onToggleBoard: (id: string) => void
  onToggleTag: (id: string) => void
  onToggleSegment?: (id: string) => void
  /** "pill" = dashed chip (chip-row variant); "toolbar" = solid Filter button. */
  variant?: 'pill' | 'toolbar'
}

/**
 * Solid "Filter" button matching the public toolbar's Search button.
 * Use as the primary entry point inline with Search.
 */
export function PublicRoadmapToolbarFilterButton(props: Omit<AddFilterButtonProps, 'variant'>) {
  return <AddFilterButton {...props} variant="toolbar" />
}

function AddFilterButton({
  boards,
  tags,
  segments,
  onToggleBoard,
  onToggleTag,
  onToggleSegment,
  variant = 'pill',
}: AddFilterButtonProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<FilterCategory | null>(null)

  const closePopover = () => {
    setOpen(false)
    setActiveCategory(null)
  }

  const showSegment = !!(onToggleSegment && segments && segments.length > 0)

  const categories = useMemo<{ key: FilterCategory; label: string; icon: IconComponent }[]>(() => {
    const list: { key: FilterCategory; label: string; icon: IconComponent }[] = [
      {
        key: 'board',
        label: intl.formatMessage({
          id: 'portal.roadmap.filter.category.board',
          defaultMessage: 'Board',
        }),
        icon: Squares2X2Icon,
      },
      {
        key: 'tags',
        label: intl.formatMessage({
          id: 'portal.roadmap.filter.category.tag',
          defaultMessage: 'Tag',
        }),
        icon: TagIcon,
      },
    ]
    if (showSegment) {
      list.push({
        key: 'segment',
        label: intl.formatMessage({
          id: 'portal.roadmap.filter.category.segment',
          defaultMessage: 'Segment',
        }),
        icon: UserGroupIcon,
      })
    }
    return list
  }, [intl, showSegment])

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) setActiveCategory(null)
      }}
    >
      <PopoverTrigger asChild>
        {variant === 'toolbar' ? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <FunnelIcon className="h-4 w-4" />
            <span className="hidden sm:inline">
              <FormattedMessage id="portal.feedback.toolbar.filter" defaultMessage="Filter" />
            </span>
          </Button>
        ) : (
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
            <FormattedMessage id="portal.feedback.filter.addFilter" defaultMessage="Add filter" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-0">
        {activeCategory === null ? (
          <div className="py-1">
            {categories.map((category) => {
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
                  aria-label={category.label}
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
              <FormattedMessage id="portal.feedback.filter.back" defaultMessage="Back" />
            </button>
            <Command>
              <CommandInput
                placeholder={intl.formatMessage({
                  id: 'portal.feedback.filter.search',
                  defaultMessage: 'Search…',
                })}
              />
              <CommandList>
                <CommandEmpty>
                  <FormattedMessage
                    id="portal.feedback.filter.noResults"
                    defaultMessage="No results."
                  />
                </CommandEmpty>

                {activeCategory === 'board' && (
                  <CommandGroup>
                    {boards.map((board) => (
                      <CommandItem
                        key={board.id}
                        value={board.name}
                        onSelect={() => {
                          onToggleBoard(board.id)
                          closePopover()
                        }}
                      >
                        {board.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {activeCategory === 'tags' && (
                  <CommandGroup>
                    {tags.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() => {
                          onToggleTag(tag.id)
                          closePopover()
                        }}
                      >
                        {tag.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {activeCategory === 'segment' && segments && (
                  <CommandGroup>
                    {segments.map((segment) => (
                      <CommandItem
                        key={segment.id}
                        value={segment.name}
                        onSelect={() => {
                          onToggleSegment?.(segment.id)
                          closePopover()
                        }}
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: segment.color }}
                        />
                        {segment.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface ActiveChipDescriptor {
  key: string
  type: FilterCategory
  label: string
  value: string
  valueId: string
  color?: string
  options?: FilterOption[]
  onChange?: (newId: string) => void
  onRemove: () => void
}

function buildActiveChips(args: {
  filters: RoadmapFilters
  onFiltersChange: (updates: Partial<RoadmapFilters>) => void
  boards: FilterBarBoard[]
  tags: Tag[]
  segments?: SegmentListItem[]
  intl: ReturnType<typeof useIntl>
}): ActiveChipDescriptor[] {
  const { filters, onFiltersChange, boards, tags, segments, intl } = args
  const chips: ActiveChipDescriptor[] = []

  if (filters.board?.length) {
    const boardOptions: FilterOption[] = boards.map((b) => ({ id: b.id, label: b.name }))
    for (const id of filters.board) {
      const board = boards.find((b) => b.id === id)
      if (!board) continue
      chips.push({
        key: `board-${id}`,
        type: 'board',
        label: intl.formatMessage({
          id: 'portal.roadmap.filter.chip.board',
          defaultMessage: 'Board:',
        }),
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
      chips.push({
        key: `tag-${id}`,
        type: 'tags',
        label: intl.formatMessage({
          id: 'portal.roadmap.filter.chip.tag',
          defaultMessage: 'Tag:',
        }),
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
      chips.push({
        key: `segment-${id}`,
        type: 'segment',
        label: intl.formatMessage({
          id: 'portal.roadmap.filter.chip.segment',
          defaultMessage: 'Segment:',
        }),
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

  return chips
}
