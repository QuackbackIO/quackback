import { useMemo, useState } from 'react'
import { toggleItem } from './filter-utils'
import {
  Squares2X2Icon,
  TagIcon,
  UserIcon,
  UserGroupIcon,
  CalendarIcon,
  ArrowTrendingUpIcon,
  ChatBubbleLeftRightIcon,
  TrashIcon,
  PlusIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FilterChip, type FilterOption } from '@/components/shared/filter-chip'
import type { InboxFilters } from './use-inbox-filters'
import type { Board, Tag as TagType, PostStatusEntity } from '@/lib/shared/db-types'
import type { TeamMember } from '@/lib/server/domains/principals'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'

interface ActiveFilter {
  key: string
  type:
    | 'status'
    | 'board'
    | 'tags'
    | 'segment'
    | 'owner'
    | 'date'
    | 'minVotes'
    | 'responded'
    | 'deleted'
  label: string
  value: string
  valueId: string
  color?: string
  onRemove: () => void
  onChange?: (newId: string) => void
  options?: FilterOption[]
}

interface ActiveFiltersBarProps {
  filters: InboxFilters
  onFiltersChange: (updates: Partial<InboxFilters>) => void
  onClearAll: () => void
  boards: Board[]
  tags: TagType[]
  statuses: PostStatusEntity[]
  members: TeamMember[]
  segments?: SegmentListItem[]
  onToggleStatus: (slug: string) => void
  onToggleBoard: (id: string) => void
  onToggleSegment?: (id: string) => void
}

type FilterCategory =
  | 'status'
  | 'board'
  | 'tags'
  | 'segment'
  | 'owner'
  | 'date'
  | 'votes'
  | 'response'

type IconComponent = React.ComponentType<{ className?: string }>

function CircleIcon({ className }: { className?: string }) {
  return <span className={`inline-block rounded-full bg-current ${className}`} />
}

const FILTER_CATEGORIES: { key: FilterCategory; label: string; icon: IconComponent }[] = [
  { key: 'status', label: 'Status', icon: CircleIcon },
  { key: 'board', label: 'Board', icon: Squares2X2Icon },
  { key: 'tags', label: 'Tag', icon: TagIcon },
  { key: 'segment', label: 'Segment', icon: UserGroupIcon },
  { key: 'owner', label: 'Assigned to', icon: UserIcon },
  { key: 'date', label: 'Created date', icon: CalendarIcon },
  { key: 'votes', label: 'Vote count', icon: ArrowTrendingUpIcon },
  { key: 'response', label: 'Team response', icon: ChatBubbleLeftRightIcon },
]

const VOTE_THRESHOLDS = [
  { value: 5, label: '5+ votes' },
  { value: 10, label: '10+ votes' },
  { value: 25, label: '25+ votes' },
  { value: 50, label: '50+ votes' },
  { value: 100, label: '100+ votes' },
]

function getDateFromDaysAgo(days: number): string {
  const date = new Date()
  if (days > 0) {
    date.setDate(date.getDate() - days)
  } else {
    date.setHours(0, 0, 0, 0)
  }
  return date.toISOString().split('T')[0]!
}

const DATE_PRESETS = [
  { value: 'today', label: 'Today', daysAgo: 0 },
  { value: '7days', label: 'Last 7 days', daysAgo: 7 },
  { value: '30days', label: 'Last 30 days', daysAgo: 30 },
  { value: '90days', label: 'Last 90 days', daysAgo: 90 },
] as const

const MENU_BUTTON_STYLES =
  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors'

interface MenuButtonProps {
  onClick: () => void
  children: React.ReactNode
  className?: string
}

function MenuButton({ onClick, children, className }: MenuButtonProps) {
  return (
    <button type="button" onClick={onClick} className={cn(MENU_BUTTON_STYLES, className)}>
      {children}
    </button>
  )
}

function AddFilterButton({
  filters,
  boards,
  tags,
  statuses,
  members,
  segments,
  onToggleStatus,
  onToggleBoard,
  onToggleSegment,
  onFiltersChange,
}: {
  filters: InboxFilters
  boards: Board[]
  tags: TagType[]
  statuses: PostStatusEntity[]
  members: TeamMember[]
  segments?: SegmentListItem[]
  onToggleStatus: (slug: string) => void
  onToggleBoard: (id: string) => void
  onToggleSegment?: (id: string) => void
  onFiltersChange: (updates: Partial<InboxFilters>) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<FilterCategory | null>(null)

  const closePopover = () => {
    setOpen(false)
    setActiveCategory(null)
  }

  const handleSelectStatus = (slug: string) => {
    onToggleStatus(slug)
    closePopover()
  }

  const handleSelectBoard = (id: string) => {
    onToggleBoard(id)
    closePopover()
  }

  const handleSelectTag = (tagId: string) => {
    onFiltersChange({ tags: toggleItem(filters.tags, tagId) })
    closePopover()
  }

  const handleSelectSegment = (segmentId: string) => {
    onToggleSegment?.(segmentId)
    closePopover()
  }

  const handleSelectOwner = (ownerId: string | 'unassigned') => {
    onFiltersChange({ owner: ownerId })
    closePopover()
  }

  const handleSelectDate = (daysAgo: number) => {
    onFiltersChange({ dateFrom: getDateFromDaysAgo(daysAgo) })
    closePopover()
  }

  const handleSelectVotes = (minVotes: number) => {
    onFiltersChange({ minVotes })
    closePopover()
  }

  const handleSelectResponse = (value: 'responded' | 'unresponded') => {
    onFiltersChange({ responded: value })
    closePopover()
  }

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
            {FILTER_CATEGORIES.map((category) => {
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
              {activeCategory === 'status' &&
                statuses.map((status) => (
                  <MenuButton key={status.id} onClick={() => handleSelectStatus(status.slug)}>
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: status.color }}
                    />
                    {status.name}
                  </MenuButton>
                ))}

              {activeCategory === 'board' &&
                boards.map((board) => (
                  <MenuButton key={board.id} onClick={() => handleSelectBoard(board.id)}>
                    {board.name}
                  </MenuButton>
                ))}

              {activeCategory === 'tags' &&
                tags.map((tag) => (
                  <MenuButton key={tag.id} onClick={() => handleSelectTag(tag.id)}>
                    {tag.name}
                  </MenuButton>
                ))}

              {activeCategory === 'segment' &&
                segments?.map((segment) => (
                  <MenuButton key={segment.id} onClick={() => handleSelectSegment(segment.id)}>
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: segment.color }}
                    />
                    {segment.name}
                  </MenuButton>
                ))}

              {activeCategory === 'owner' && (
                <>
                  <MenuButton
                    onClick={() => handleSelectOwner('unassigned')}
                    className="text-muted-foreground"
                  >
                    Unassigned
                  </MenuButton>
                  {members.map((member) => (
                    <MenuButton key={member.id} onClick={() => handleSelectOwner(member.id)}>
                      {member.name || member.email}
                    </MenuButton>
                  ))}
                </>
              )}

              {activeCategory === 'date' &&
                DATE_PRESETS.map((preset) => (
                  <MenuButton key={preset.value} onClick={() => handleSelectDate(preset.daysAgo)}>
                    {preset.label}
                  </MenuButton>
                ))}

              {activeCategory === 'votes' &&
                VOTE_THRESHOLDS.map((threshold) => (
                  <MenuButton
                    key={threshold.value}
                    onClick={() => handleSelectVotes(threshold.value)}
                  >
                    {threshold.label}
                  </MenuButton>
                ))}

              {activeCategory === 'response' && (
                <>
                  <MenuButton onClick={() => handleSelectResponse('responded')}>
                    Responded
                  </MenuButton>
                  <MenuButton onClick={() => handleSelectResponse('unresponded')}>
                    Unresponded
                  </MenuButton>
                </>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function getFilterIcon(type: ActiveFilter['type']): IconComponent {
  const icons: Record<ActiveFilter['type'], IconComponent> = {
    status: CircleIcon,
    board: Squares2X2Icon,
    tags: TagIcon,
    segment: UserGroupIcon,
    owner: UserIcon,
    date: CalendarIcon,
    minVotes: ArrowTrendingUpIcon,
    responded: ChatBubbleLeftRightIcon,
    deleted: TrashIcon,
  }
  return icons[type]
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function computeActiveFilters(
  filters: InboxFilters,
  boards: Board[],
  tags: TagType[],
  statuses: PostStatusEntity[],
  members: TeamMember[],
  segments: SegmentListItem[] | undefined,
  onFiltersChange: (updates: Partial<InboxFilters>) => void
): ActiveFilter[] {
  const result: ActiveFilter[] = []

  // Build options arrays for dropdowns
  const statusOptions: FilterOption[] = statuses.map((s) => ({
    id: s.slug,
    label: s.name,
    color: s.color,
  }))
  const boardOptions: FilterOption[] = boards.map((b) => ({
    id: b.id,
    label: b.name,
  }))
  const tagOptions: FilterOption[] = tags.map((t) => ({
    id: t.id,
    label: t.name,
  }))
  const ownerOptions: FilterOption[] = [
    { id: 'unassigned', label: 'Unassigned' },
    ...members.map((m) => ({ id: m.id, label: m.name || m.email })),
  ]

  // Status filters
  if (filters.status?.length) {
    filters.status.forEach((slug) => {
      const status = statuses.find((s) => s.slug === slug)
      if (status) {
        result.push({
          key: `status-${slug}`,
          type: 'status',
          label: 'Status:',
          value: status.name,
          valueId: slug,
          color: status.color,
          options: statusOptions,
          onChange: (newSlug) => {
            const otherStatuses = filters.status?.filter((s) => s !== slug) || []
            onFiltersChange({
              status: [...otherStatuses, newSlug],
            })
          },
          onRemove: () => {
            const newStatus = filters.status?.filter((s) => s !== slug)
            onFiltersChange({
              status: newStatus?.length ? newStatus : undefined,
            })
          },
        })
      }
    })
  }

  // Board filters
  if (filters.board?.length) {
    filters.board.forEach((id) => {
      const board = boards.find((b) => b.id === id)
      if (board) {
        result.push({
          key: `board-${id}`,
          type: 'board',
          label: 'Board:',
          value: board.name,
          valueId: id,
          options: boardOptions,
          onChange: (newId) => {
            const otherBoards = filters.board?.filter((b) => b !== id) || []
            onFiltersChange({
              board: [...otherBoards, newId],
            })
          },
          onRemove: () => {
            const newBoards = filters.board?.filter((b) => b !== id)
            onFiltersChange({
              board: newBoards?.length ? newBoards : undefined,
            })
          },
        })
      }
    })
  }

  // Tags (always include mode, combine if many)
  if (filters.tags?.length) {
    const tagNames = filters.tags
      .map((id) => tags.find((t) => t.id === id)?.name)
      .filter(Boolean) as string[]

    if (tagNames.length <= 2) {
      // Individual chips for 1-2 tags
      filters.tags.forEach((id) => {
        const tag = tags.find((t) => t.id === id)
        if (tag) {
          result.push({
            key: `tag-${id}`,
            type: 'tags',
            label: 'Tag:',
            value: tag.name,
            valueId: id,
            options: tagOptions,
            onChange: (newId) => {
              const otherTags = filters.tags?.filter((t) => t !== id) || []
              onFiltersChange({ tags: [...otherTags, newId] })
            },
            onRemove: () => {
              const newTags = filters.tags?.filter((t) => t !== id)
              onFiltersChange({ tags: newTags?.length ? newTags : undefined })
            },
          })
        }
      })
    } else {
      // Combined chip for 3+ tags - no dropdown
      result.push({
        key: 'tags-combined',
        type: 'tags',
        label: 'Tags:',
        value: `${tagNames.slice(0, 2).join(', ')} +${tagNames.length - 2}`,
        valueId: 'combined',
        onRemove: () => onFiltersChange({ tags: undefined }),
      })
    }
  }

  // Segment filters
  if (filters.segmentIds?.length && segments) {
    const segmentOptions: FilterOption[] = segments.map((s) => ({
      id: s.id,
      label: s.name,
      color: s.color,
    }))

    filters.segmentIds.forEach((id) => {
      const segment = segments.find((s) => s.id === id)
      if (segment) {
        result.push({
          key: `segment-${id}`,
          type: 'segment',
          label: 'Segment:',
          value: segment.name,
          valueId: id,
          color: segment.color,
          options: segmentOptions,
          onChange: (newId) => {
            const otherSegments = filters.segmentIds?.filter((s) => s !== id) || []
            onFiltersChange({ segmentIds: [...otherSegments, newId] })
          },
          onRemove: () => {
            const newSegments = filters.segmentIds?.filter((s) => s !== id)
            onFiltersChange({ segmentIds: newSegments?.length ? newSegments : undefined })
          },
        })
      }
    })
  }

  // Owner filter
  if (filters.owner) {
    const ownerName =
      filters.owner === 'unassigned'
        ? 'Unassigned'
        : members.find((m) => m.id === filters.owner)?.name || 'Unknown'

    result.push({
      key: 'owner',
      type: 'owner',
      label: 'Assigned:',
      value: ownerName,
      valueId: filters.owner,
      options: ownerOptions,
      onChange: (newId) => onFiltersChange({ owner: newId }),
      onRemove: () => onFiltersChange({ owner: undefined }),
    })
  }

  // Date range - dropdown with presets
  const dateOptions: FilterOption[] = DATE_PRESETS.map((p) => ({
    id: p.value,
    label: p.label,
  }))

  if (filters.dateFrom) {
    // Try to match current date to a preset for display
    const matchedPreset = DATE_PRESETS.find(
      (p) => getDateFromDaysAgo(p.daysAgo) === filters.dateFrom
    )

    result.push({
      key: 'date',
      type: 'date',
      label: 'Date:',
      value: matchedPreset ? matchedPreset.label : formatDate(filters.dateFrom),
      valueId: matchedPreset?.value || filters.dateFrom,
      options: dateOptions,
      onChange: (presetId) => {
        const preset = DATE_PRESETS.find((p) => p.value === presetId)
        if (preset) {
          onFiltersChange({ dateFrom: getDateFromDaysAgo(preset.daysAgo) })
        }
      },
      onRemove: () => onFiltersChange({ dateFrom: undefined }),
    })
  }

  // Min votes - dropdown with thresholds
  const voteOptions: FilterOption[] = VOTE_THRESHOLDS.map((t) => ({
    id: t.value.toString(),
    label: t.label,
  }))

  if (filters.minVotes) {
    const matchedThreshold = VOTE_THRESHOLDS.find((t) => t.value === filters.minVotes)

    result.push({
      key: 'minVotes',
      type: 'minVotes',
      label: 'Min votes:',
      value: matchedThreshold ? matchedThreshold.label : `${filters.minVotes}+`,
      valueId: filters.minVotes.toString(),
      options: voteOptions,
      onChange: (newValue) => onFiltersChange({ minVotes: parseInt(newValue, 10) }),
      onRemove: () => onFiltersChange({ minVotes: undefined }),
    })
  }

  // Response filter
  const respondedOptions: FilterOption[] = [
    { id: 'responded', label: 'Responded' },
    { id: 'unresponded', label: 'Unresponded' },
  ]

  if (filters.responded && filters.responded !== 'all') {
    result.push({
      key: 'responded',
      type: 'responded',
      label: 'Team response:',
      value: filters.responded === 'responded' ? 'Responded' : 'Unresponded',
      valueId: filters.responded,
      options: respondedOptions,
      onChange: (newValue) =>
        onFiltersChange({ responded: newValue as 'responded' | 'unresponded' }),
      onRemove: () => onFiltersChange({ responded: undefined }),
    })
  }

  // Deleted posts filter
  if (filters.showDeleted) {
    result.push({
      key: 'deleted',
      type: 'deleted',
      label: '',
      value: 'Deleted posts',
      valueId: 'deleted',
      onRemove: () => onFiltersChange({ showDeleted: undefined }),
    })
  }

  return result
}

export function ActiveFiltersBar({
  filters,
  onFiltersChange,
  onClearAll,
  boards,
  tags,
  statuses,
  members,
  segments,
  onToggleStatus,
  onToggleBoard,
  onToggleSegment,
}: ActiveFiltersBarProps) {
  const activeFilters = useMemo(
    () => computeActiveFilters(filters, boards, tags, statuses, members, segments, onFiltersChange),
    [filters, boards, tags, statuses, members, segments, onFiltersChange]
  )

  return (
    <div className="bg-card/50" role="region" aria-label="Active filters">
      <div className="flex flex-wrap gap-1 items-center">
        {activeFilters.map(({ key, type, ...filterProps }) => (
          <FilterChip key={key} icon={getFilterIcon(type)} {...filterProps} />
        ))}

        <AddFilterButton
          filters={filters}
          boards={boards}
          tags={tags}
          statuses={statuses}
          members={members}
          segments={segments}
          onToggleStatus={onToggleStatus}
          onToggleBoard={onToggleBoard}
          onToggleSegment={onToggleSegment}
          onFiltersChange={onFiltersChange}
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
