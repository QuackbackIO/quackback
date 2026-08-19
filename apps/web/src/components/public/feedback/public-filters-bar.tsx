import { useMemo, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import {
  Squares2X2Icon,
  TagIcon,
  CalendarIcon,
  ArrowTrendingUpIcon,
  ChatBubbleLeftRightIcon,
  UserIcon,
  UserGroupIcon,
  PlusIcon,
  ChevronRightIcon,
  FunnelIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { usePortalPermissions } from '@/lib/client/hooks/use-portal-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { useTeamMembers } from '@/lib/client/hooks/use-team-members'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import type { TeamMember } from '@/lib/shared/types'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'
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
import type { PublicFeedbackFilters } from '@/lib/shared/types'
import type { PostStatusEntity, PostTag } from '@/lib/shared/db-types'
import { toggleItem } from '@/components/shared/filter-utils'
import { CircleIcon } from '@/components/shared/filter-menu'
import {
  VOTE_THRESHOLDS,
  DATE_PRESETS,
  RESPONDED_OPTIONS,
  STATUS_CATEGORY_ORDER,
  getDateFromDaysAgo,
  type DatePresetValue,
  type RespondedValue,
} from './public-filters-bar-defaults'

interface FilterBarBoard {
  id: string
  slug: string
  name: string
}

type FilterCategory =
  | 'board'
  | 'status'
  | 'tag'
  | 'votes'
  | 'date'
  | 'response'
  | 'owner'
  | 'segment'
type ChipType = 'board' | 'status' | 'tags' | 'votes' | 'date' | 'response' | 'owner' | 'segment'

type IconComponent = React.ComponentType<{ className?: string }>

const CHIP_ICON_BY_TYPE: Record<ChipType, IconComponent> = {
  board: Squares2X2Icon,
  status: CircleIcon,
  tags: TagIcon,
  votes: ArrowTrendingUpIcon,
  date: CalendarIcon,
  response: ChatBubbleLeftRightIcon,
  owner: UserIcon,
  segment: UserGroupIcon,
}

/**
 * Team-only filters (owner, segment) are rendered only for holders of
 * post.view_private and always styled amber to signal they are internal.
 * `useTeamOnlyFilterOptions` centralizes the permission gate + option loading
 * so the chip row and the add-filter menu stay in sync; the queries are only
 * enabled for privileged callers, and an empty/failed option list simply hides
 * the corresponding filter rather than erroring.
 */
function useTeamOnlyFilterOptions(): {
  canViewPrivate: boolean
  members: TeamMember[]
  segments: SegmentListItem[]
} {
  const { can } = usePortalPermissions()
  const canViewPrivate = can(PERMISSIONS.POST_VIEW_PRIVATE)
  const { data: members } = useTeamMembers({ enabled: canViewPrivate })
  const { data: segments } = useSegments({ enabled: canViewPrivate })
  return {
    canViewPrivate,
    members: canViewPrivate ? (members ?? []) : [],
    segments: canViewPrivate ? (segments ?? []) : [],
  }
}

interface PublicFiltersBarProps {
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  clearFilters: () => void
  statuses: PostStatusEntity[]
  tags: PostTag[]
  boards: FilterBarBoard[]
}

export function PublicFiltersBar({
  filters,
  setFilters,
  clearFilters,
  statuses,
  tags,
  boards,
}: PublicFiltersBarProps) {
  const intl = useIntl()
  const { members, segments } = useTeamOnlyFilterOptions()

  const activeChips = useMemo(
    () =>
      buildActiveChips({ filters, setFilters, statuses, tags, boards, members, segments, intl }),
    [filters, setFilters, statuses, tags, boards, members, segments, intl]
  )

  if (activeChips.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Active filters"
      className="flex flex-wrap gap-2 items-center py-0.5"
    >
      {activeChips.map(({ key, type, ...chipProps }) => (
        <FilterChip key={key} icon={CHIP_ICON_BY_TYPE[type]} {...chipProps} />
      ))}

      <AddFilterButton
        filters={filters}
        setFilters={setFilters}
        statuses={statuses}
        tags={tags}
        boards={boards}
        variant="pill"
      />

      {activeChips.length >= 2 && (
        <button
          type="button"
          onClick={clearFilters}
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
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  statuses: PostStatusEntity[]
  tags: PostTag[]
  boards: FilterBarBoard[]
  /**
   * Trigger style:
   *   - "pill" (default): dashed "+ Add filter" pill that matches the chip shape.
   *     Use inside the active-chips row.
   *   - "toolbar": solid Filter button matching the toolbar's Search button.
   *     Use as the primary entry point next to Search.
   */
  variant?: 'pill' | 'toolbar'
}

/**
 * "Filter" button styled to match the toolbar's Search button. Use as the
 * primary filter entry point inline with Search.
 */
export function PublicFiltersToolbarButton(props: Omit<AddFilterButtonProps, 'variant'>) {
  return <AddFilterButton {...props} variant="toolbar" />
}

/**
 * Dashed "+ Add filter" pill styled to match the chip shape. Use as the
 * "add another" affordance at the end of the active-chips row.
 */
export function PublicFiltersAddButton(props: Omit<AddFilterButtonProps, 'variant'>) {
  return <AddFilterButton {...props} variant="pill" />
}

function AddFilterButton({
  filters,
  setFilters,
  statuses,
  tags,
  boards,
  variant = 'pill',
}: AddFilterButtonProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<FilterCategory | null>(null)
  const { members, segments } = useTeamOnlyFilterOptions()

  const closePopover = () => {
    setOpen(false)
    setActiveCategory(null)
  }

  const showBoardCategory = boards.length > 1
  // Team-only categories are hidden entirely for non-privileged callers (empty
  // option lists) and also hide individually when their option query is empty.
  const showOwnerCategory = members.length > 0
  const showSegmentCategory = segments.length > 0

  const categories = useMemo<{ key: FilterCategory; label: string; icon: IconComponent }[]>(() => {
    const list: { key: FilterCategory; label: string; icon: IconComponent }[] = []
    if (showBoardCategory) {
      list.push({
        key: 'board',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.category.board',
          defaultMessage: 'Board',
        }),
        icon: Squares2X2Icon,
      })
    }
    list.push(
      {
        key: 'status',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.category.status',
          defaultMessage: 'Status',
        }),
        icon: CircleIcon,
      },
      {
        key: 'tag',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.category.tag',
          defaultMessage: 'Tag',
        }),
        icon: TagIcon,
      },
      {
        key: 'votes',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.category.votes',
          defaultMessage: 'Vote count',
        }),
        icon: ArrowTrendingUpIcon,
      },
      {
        key: 'date',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.category.date',
          defaultMessage: 'Created date',
        }),
        icon: CalendarIcon,
      },
      {
        key: 'response',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.category.response',
          defaultMessage: 'Team response',
        }),
        icon: ChatBubbleLeftRightIcon,
      }
    )
    // Team-only categories, appended last and amber-tinted in the menu so they
    // read as internal. Only rendered for post.view_private holders (the option
    // lists are empty otherwise).
    if (showOwnerCategory) {
      list.push({
        key: 'owner',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.category.owner',
          defaultMessage: 'Owner',
        }),
        icon: UserIcon,
      })
    }
    if (showSegmentCategory) {
      list.push({
        key: 'segment',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.category.segment',
          defaultMessage: 'Segment',
        }),
        icon: UserGroupIcon,
      })
    }
    return list
  }, [intl, showBoardCategory, showOwnerCategory, showSegmentCategory])

  const groupedStatuses = useMemo(() => {
    const groups: Record<string, PostStatusEntity[]> = {}
    for (const cat of STATUS_CATEGORY_ORDER) groups[cat] = []
    for (const s of statuses) {
      const cat = (s.category ?? 'active') as string
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(s)
    }
    return groups
  }, [statuses])

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
              const isInternal = category.key === 'owner' || category.key === 'segment'
              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setActiveCategory(category.key)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-2.5 py-1.5',
                    'text-xs text-left',
                    'hover:bg-muted/50 transition-colors',
                    isInternal && 'text-amber-700 dark:text-amber-500'
                  )}
                  aria-label={category.label}
                >
                  <span className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        'h-3.5 w-3.5',
                        isInternal ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'
                      )}
                    />
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
              {/* Hide the search input for short, fixed-preset lists where
                  filtering adds no value (votes / date / response). */}
              {(activeCategory === 'board' ||
                activeCategory === 'status' ||
                activeCategory === 'tag' ||
                activeCategory === 'owner' ||
                activeCategory === 'segment') && (
                <CommandInput
                  placeholder={intl.formatMessage({
                    id: 'portal.feedback.filter.search',
                    defaultMessage: 'Search…',
                  })}
                />
              )}
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
                          setFilters({ board: board.slug })
                          closePopover()
                        }}
                      >
                        {board.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {activeCategory === 'status' &&
                  STATUS_CATEGORY_ORDER.map((cat) => {
                    const list = groupedStatuses[cat] ?? []
                    if (list.length === 0) return null
                    return (
                      <CommandGroup
                        key={cat}
                        heading={intl.formatMessage({
                          id: `portal.feedback.filter.statusGroup.${cat}`,
                          defaultMessage: cat[0].toUpperCase() + cat.slice(1),
                        })}
                      >
                        {list.map((status) => (
                          <CommandItem
                            key={status.id}
                            value={status.name}
                            onSelect={() => {
                              setFilters({ status: toggleItem(filters.status, status.slug) })
                              closePopover()
                            }}
                          >
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: status.color }}
                            />
                            {status.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )
                  })}

                {activeCategory === 'tag' && (
                  <CommandGroup>
                    {tags.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() => {
                          setFilters({ tagIds: toggleItem(filters.tagIds, tag.id) })
                          closePopover()
                        }}
                      >
                        {tag.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {activeCategory === 'votes' && (
                  <CommandGroup>
                    {VOTE_THRESHOLDS.map((t) => (
                      <CommandItem
                        key={t.value}
                        value={t.label}
                        onSelect={() => {
                          setFilters({ minVotes: t.value })
                          closePopover()
                        }}
                      >
                        {t.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {activeCategory === 'date' && (
                  <CommandGroup>
                    {DATE_PRESETS.map((p) => (
                      <CommandItem
                        key={p.value}
                        value={p.label}
                        onSelect={() => {
                          setFilters({ dateFrom: getDateFromDaysAgo(p.daysAgo) })
                          closePopover()
                        }}
                      >
                        {p.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {activeCategory === 'response' && (
                  <CommandGroup>
                    {RESPONDED_OPTIONS.map((opt) => (
                      <CommandItem
                        key={opt.value}
                        value={opt.label}
                        onSelect={() => {
                          setFilters({ responded: opt.value })
                          closePopover()
                        }}
                      >
                        {opt.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {activeCategory === 'owner' && (
                  <CommandGroup>
                    <CommandItem
                      value={intl.formatMessage({
                        id: 'portal.feedback.filter.owner.unassigned',
                        defaultMessage: 'Unassigned',
                      })}
                      onSelect={() => {
                        setFilters({ owner: 'unassigned' })
                        closePopover()
                      }}
                    >
                      <span className="text-muted-foreground">
                        <FormattedMessage
                          id="portal.feedback.filter.owner.unassigned"
                          defaultMessage="Unassigned"
                        />
                      </span>
                    </CommandItem>
                    {members.map((member) => (
                      <CommandItem
                        key={member.id}
                        value={member.name || member.email || member.id}
                        onSelect={() => {
                          setFilters({ owner: member.id })
                          closePopover()
                        }}
                      >
                        {member.name || member.email}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {activeCategory === 'segment' && (
                  <CommandGroup>
                    {segments.map((segment) => (
                      <CommandItem
                        key={segment.id}
                        value={segment.name}
                        onSelect={() => {
                          setFilters({ segmentIds: toggleItem(filters.segmentIds, segment.id) })
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
  type: ChipType
  label: string
  value: string
  valueId: string
  color?: string
  options?: FilterOption[]
  onChange?: (newId: string) => void
  onRemove: () => void
  /** Team-only chip: amber styling. */
  internal?: boolean
  /** Localized "only your team sees this" tooltip for internal chips. */
  tooltip?: string
}

function buildActiveChips(args: {
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  statuses: PostStatusEntity[]
  tags: PostTag[]
  boards: FilterBarBoard[]
  members: TeamMember[]
  segments: SegmentListItem[]
  intl: ReturnType<typeof useIntl>
}): ActiveChipDescriptor[] {
  const { filters, setFilters, statuses, tags, boards, members, segments, intl } = args
  const chips: ActiveChipDescriptor[] = []

  // Board chip — only shown when a specific board is selected (omit for
  // "All Posts"). Single-select: switching replaces the value.
  if (filters.board && boards.length > 1) {
    const board = boards.find((b) => b.slug === filters.board)
    if (board) {
      const boardOptions: FilterOption[] = boards.map((b) => ({ id: b.slug, label: b.name }))
      chips.push({
        key: `board-${board.slug}`,
        type: 'board',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.chip.board',
          defaultMessage: 'Board:',
        }),
        value: board.name,
        valueId: board.slug,
        options: boardOptions,
        onChange: (newSlug) => setFilters({ board: newSlug }),
        onRemove: () => setFilters({ board: undefined }),
      })
    }
  }

  const statusOptions: FilterOption[] = statuses.map((s) => ({
    id: s.slug,
    label: s.name,
    color: s.color,
  }))

  // Status chips — one per selected slug
  if (filters.status?.length) {
    for (const slug of filters.status) {
      const status = statuses.find((s) => s.slug === slug)
      if (!status) continue
      chips.push({
        key: `status-${slug}`,
        type: 'status',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.chip.status',
          defaultMessage: 'Status:',
        }),
        value: status.name,
        valueId: slug,
        color: status.color,
        options: statusOptions,
        onChange: (newSlug) => {
          const others = filters.status?.filter((s) => s !== slug) ?? []
          setFilters({ status: [...others, newSlug] })
        },
        onRemove: () => {
          const next = filters.status?.filter((s) => s !== slug)
          setFilters({ status: next?.length ? next : undefined })
        },
      })
    }
  }

  // Tags — 1-2 individual, 3+ combined
  if (filters.tagIds?.length) {
    const tagOptions: FilterOption[] = tags.map((t) => ({ id: t.id, label: t.name }))
    if (filters.tagIds.length <= 2) {
      for (const id of filters.tagIds) {
        const tag = tags.find((t) => t.id === id)
        if (!tag) continue
        chips.push({
          key: `tag-${id}`,
          type: 'tags',
          label: intl.formatMessage({
            id: 'portal.feedback.filter.chip.tag',
            defaultMessage: 'Tag:',
          }),
          value: tag.name,
          valueId: id,
          options: tagOptions,
          onChange: (newId) => {
            const others = filters.tagIds?.filter((t) => t !== id) ?? []
            setFilters({ tagIds: [...others, newId] })
          },
          onRemove: () => {
            const next = filters.tagIds?.filter((t) => t !== id)
            setFilters({ tagIds: next?.length ? next : undefined })
          },
        })
      }
    } else {
      const names = filters.tagIds
        .map((id) => tags.find((t) => t.id === id)?.name)
        .filter((n): n is string => !!n)
      chips.push({
        key: 'tags-combined',
        type: 'tags',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.chip.tags',
          defaultMessage: 'Tags:',
        }),
        value: `${names.slice(0, 2).join(', ')} +${names.length - 2}`,
        valueId: 'combined',
        onRemove: () => setFilters({ tagIds: undefined }),
      })
    }
  }

  // Vote count
  if (filters.minVotes) {
    const opts: FilterOption[] = VOTE_THRESHOLDS.map((t) => ({
      id: String(t.value),
      label: t.label,
    }))
    const matched = VOTE_THRESHOLDS.find((t) => t.value === filters.minVotes)
    chips.push({
      key: 'minVotes',
      type: 'votes',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.votes',
        defaultMessage: 'Min votes:',
      }),
      value: matched ? matched.label : `${filters.minVotes}+`,
      valueId: String(filters.minVotes),
      options: opts,
      onChange: (id) => setFilters({ minVotes: parseInt(id, 10) }),
      onRemove: () => setFilters({ minVotes: undefined }),
    })
  }

  // Created date
  if (filters.dateFrom) {
    const opts: FilterOption[] = DATE_PRESETS.map((p) => ({ id: p.value, label: p.label }))
    const matched = DATE_PRESETS.find((p) => getDateFromDaysAgo(p.daysAgo) === filters.dateFrom)
    chips.push({
      key: 'dateFrom',
      type: 'date',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.date',
        defaultMessage: 'Date:',
      }),
      value: matched ? matched.label : filters.dateFrom,
      valueId: matched?.value ?? filters.dateFrom,
      options: opts,
      onChange: (presetId) => {
        const preset = DATE_PRESETS.find((p) => p.value === (presetId as DatePresetValue))
        if (preset) setFilters({ dateFrom: getDateFromDaysAgo(preset.daysAgo) })
      },
      onRemove: () => setFilters({ dateFrom: undefined }),
    })
  }

  // Team response
  if (filters.responded) {
    const opts: FilterOption[] = RESPONDED_OPTIONS.map((o) => ({ id: o.value, label: o.label }))
    const matched = RESPONDED_OPTIONS.find((o) => o.value === filters.responded)
    chips.push({
      key: 'responded',
      type: 'response',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.response',
        defaultMessage: 'Team response:',
      }),
      value: matched?.label ?? filters.responded,
      valueId: filters.responded,
      options: opts,
      onChange: (id) => setFilters({ responded: id as RespondedValue }),
      onRemove: () => setFilters({ responded: undefined }),
    })
  }

  // Team-only chips. The server ignores these params without post.view_private,
  // but they are also only *rendered* when the option lists are non-empty (which
  // requires the privileged queries to have resolved), so a customer never sees
  // them even if an owner/segment value somehow lands in the URL.
  const internalTooltip = intl.formatMessage({
    id: 'portal.feedback.filter.internal.tooltip',
    defaultMessage: 'Only your team sees this',
  })

  // Owner — single-select; 'unassigned' is a first-class value.
  if (filters.owner && (members.length > 0 || filters.owner === 'unassigned')) {
    const unassignedLabel = intl.formatMessage({
      id: 'portal.feedback.filter.owner.unassigned',
      defaultMessage: 'Unassigned',
    })
    const ownerOptions: FilterOption[] = [
      { id: 'unassigned', label: unassignedLabel },
      ...members.map((m) => ({ id: m.id, label: m.name || m.email || m.id })),
    ]
    const ownerValue =
      filters.owner === 'unassigned'
        ? unassignedLabel
        : (members.find((m) => m.id === filters.owner)?.name ??
          members.find((m) => m.id === filters.owner)?.email ??
          filters.owner)
    chips.push({
      key: 'owner',
      type: 'owner',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.owner',
        defaultMessage: 'Owner:',
      }),
      value: ownerValue,
      valueId: filters.owner,
      options: ownerOptions,
      internal: true,
      tooltip: internalTooltip,
      onChange: (newId) => setFilters({ owner: newId }),
      onRemove: () => setFilters({ owner: undefined }),
    })
  }

  // Segments — one chip per selected id (multi-select), matching tag anatomy.
  if (filters.segmentIds?.length && segments.length > 0) {
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
          id: 'portal.feedback.filter.chip.segment',
          defaultMessage: 'Segment:',
        }),
        value: segment.name,
        valueId: id,
        color: segment.color,
        options: segmentOptions,
        internal: true,
        tooltip: internalTooltip,
        onChange: (newId) => {
          const others = filters.segmentIds?.filter((s) => s !== id) ?? []
          setFilters({ segmentIds: [...others, newId] })
        },
        onRemove: () => {
          const next = filters.segmentIds?.filter((s) => s !== id)
          setFilters({ segmentIds: next?.length ? next : undefined })
        },
      })
    }
  }

  return chips
}
