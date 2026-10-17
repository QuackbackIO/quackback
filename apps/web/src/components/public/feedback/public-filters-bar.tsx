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
  EyeIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { usePortalPermissions } from '@/lib/client/hooks/use-portal-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { useTeamMembers } from '@/lib/client/hooks/use-team-members'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import type { TeamMember } from '@/lib/shared/types'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'
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
import { PUBLIC_FEED_VIEWS, type PublicFeedView } from '@/lib/shared/types/filters'
import type { PostStatusEntity, PostTag } from '@/lib/shared/db-types'
import { toggleItem } from '@/components/shared/filter-utils'
import { CircleIcon } from '@/components/shared/filter-menu'
import {
  VOTE_THRESHOLDS,
  DATE_PRESETS,
  RESPONDED_OPTIONS,
  getDateFromDaysAgo,
  type DatePresetValue,
  type RespondedValue,
  STATUS_CATEGORY_ORDER,
  STATUS_GROUP_LABELS,
} from './public-filters-bar-defaults'

interface FilterBarBoard {
  id: string
  slug: string
  name: string
}

type FilterCategory = 'votes' | 'date' | 'response' | 'owner' | 'segment'
type ChipType =
  'view' | 'board' | 'status' | 'tags' | 'votes' | 'date' | 'response' | 'owner' | 'segment'

type IconComponent = React.ComponentType<{ className?: string }>
type IntlShape = ReturnType<typeof useIntl>

const DATE_PRESET_LABELS: Record<DatePresetValue, { id: string; defaultMessage: string }> = {
  today: { id: 'portal.feedback.filter.date.today', defaultMessage: 'Today' },
  '7days': { id: 'portal.feedback.filter.date.last7Days', defaultMessage: 'Last 7 days' },
  '30days': { id: 'portal.feedback.filter.date.last30Days', defaultMessage: 'Last 30 days' },
  '90days': { id: 'portal.feedback.filter.date.last90Days', defaultMessage: 'Last 90 days' },
}

const RESPONDED_LABELS: Record<RespondedValue, { id: string; defaultMessage: string }> = {
  responded: {
    id: 'portal.feedback.filter.response.responded',
    defaultMessage: 'Has team response',
  },
  unresponded: {
    id: 'portal.feedback.filter.response.unresponded',
    defaultMessage: 'Awaiting team response',
  },
}

function votesLabel(intl: IntlShape, minVotes: number): string {
  return intl.formatMessage(
    { id: 'portal.feedback.filter.votes.min', defaultMessage: '{count}+ votes' },
    { count: minVotes }
  )
}

const CHIP_ICON_BY_TYPE: Record<ChipType, IconComponent> = {
  view: EyeIcon,
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
      buildActiveChips({
        filters,
        setFilters,
        statuses,
        tags,
        boards,
        members,
        segments,
        intl,
      }),
    [filters, setFilters, statuses, tags, boards, members, segments, intl]
  )

  if (activeChips.length === 0) return null

  return (
    <div
      role="region"
      aria-label={intl.formatMessage({
        id: 'portal.feedback.filter.activeFilters',
        defaultMessage: 'Active filters',
      })}
      className="flex flex-wrap gap-2 items-center py-0.5"
    >
      {activeChips.map(({ key, type, ...chipProps }) => (
        <FilterChip key={key} icon={CHIP_ICON_BY_TYPE[type]} {...chipProps} />
      ))}

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
}

/**
 * Dashed "+ Add filter" pill for the less common filters (votes, date, team
 * response), at the foot of the filter panel.
 */
export function PublicFiltersAddButton({ filters, setFilters }: AddFilterButtonProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<FilterCategory | null>(null)
  const { members, segments } = useTeamOnlyFilterOptions()

  const closePopover = () => {
    setOpen(false)
    setActiveCategory(null)
  }

  // Team-only categories are hidden entirely for non-privileged callers (empty
  // option lists) and also hide individually when their option query is empty.
  const showOwnerCategory = members.length > 0
  const showSegmentCategory = segments.length > 0

  const categories = useMemo<{ key: FilterCategory; label: string; icon: IconComponent }[]>(() => {
    // Board, status and tags live in the filter panel; this menu holds the rest.
    const list: { key: FilterCategory; label: string; icon: IconComponent }[] = []
    list.push(
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
  }, [intl, showOwnerCategory, showSegmentCategory])

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
            'border border-dashed border-muted-foreground/40',
            'text-muted-foreground hover:text-foreground',
            'hover:border-muted-foreground hover:bg-muted/30',
            'transition-colors'
          )}
        >
          <PlusIcon className="h-3 w-3" />
          <FormattedMessage id="portal.feedback.filter.addFilter" defaultMessage="Add filter" />
        </button>
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
              {(activeCategory === 'owner' || activeCategory === 'segment') && (
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

                {activeCategory === 'votes' && (
                  <CommandGroup>
                    {VOTE_THRESHOLDS.map((t) => (
                      <CommandItem
                        key={t.value}
                        value={votesLabel(intl, t.value)}
                        onSelect={() => {
                          setFilters({ minVotes: t.value })
                          closePopover()
                        }}
                      >
                        {votesLabel(intl, t.value)}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {activeCategory === 'date' && (
                  <CommandGroup>
                    {DATE_PRESETS.map((p) => (
                      <CommandItem
                        key={p.value}
                        value={intl.formatMessage(DATE_PRESET_LABELS[p.value])}
                        onSelect={() => {
                          setFilters({ dateFrom: getDateFromDaysAgo(p.daysAgo) })
                          closePopover()
                        }}
                      >
                        {intl.formatMessage(DATE_PRESET_LABELS[p.value])}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {activeCategory === 'response' && (
                  <CommandGroup>
                    {RESPONDED_OPTIONS.map((opt) => (
                      <CommandItem
                        key={opt.value}
                        value={intl.formatMessage(RESPONDED_LABELS[opt.value])}
                        onSelect={() => {
                          setFilters({ responded: opt.value })
                          closePopover()
                        }}
                      >
                        {intl.formatMessage(RESPONDED_LABELS[opt.value])}
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
  intl: IntlShape
}): ActiveChipDescriptor[] {
  const { filters, setFilters, statuses, tags, boards, members, segments, intl } = args
  const chips: ActiveChipDescriptor[] = []

  // View chip (My ideas, Voted, Following), so the view is never hidden in
  // the panel alone.
  if (filters.view) {
    const viewLabels = {
      mine: intl.formatMessage({
        id: 'portal.feedback.panel.view.mine',
        defaultMessage: 'My ideas',
      }),
      voted: intl.formatMessage({
        id: 'portal.feedback.panel.view.voted',
        defaultMessage: 'Voted',
      }),
      following: intl.formatMessage({
        id: 'portal.feedback.panel.view.following',
        defaultMessage: 'Following',
      }),
    }
    chips.push({
      key: 'view',
      type: 'view',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.view',
        defaultMessage: 'Show:',
      }),
      value: viewLabels[filters.view],
      valueId: filters.view,
      options: PUBLIC_FEED_VIEWS.map((view) => ({ id: view, label: viewLabels[view] })),
      onChange: (view) => setFilters({ view: view as PublicFeedView }),
      onRemove: () => setFilters({ view: undefined }),
    })
  }

  // Board chip — only shown when a specific board is selected (omit for
  // "All Posts").
  if (filters.board && boards.length > 1) {
    const board = boards.find((b) => b.slug === filters.board)
    if (board) {
      chips.push({
        key: `board-${board.slug}`,
        type: 'board',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.chip.board',
          defaultMessage: 'Board:',
        }),
        value: board.name,
        valueId: board.slug,
        options: boards.map((b) => ({ id: b.slug, label: b.name })),
        onChange: (newSlug: string) => setFilters({ board: newSlug }),
        onRemove: () => setFilters({ board: undefined }),
      })
    }
  }

  // Status: one chip, only when the pick differs from the default scope (the
  // panel's ticks show that scope). It names whole groups where it can.
  if (filters.status?.length) {
    const picked = filters.status.map(
      (value) => statuses.find((s) => s.id === value)?.slug ?? value
    )
    const parts: string[] = []
    for (const category of STATUS_CATEGORY_ORDER) {
      const group = statuses.filter((s) => (s.category ?? 'active') === category)
      const inGroup = group.filter((s) => picked.includes(s.slug))
      if (group.length > 1 && inGroup.length === group.length) {
        parts.push(intl.formatMessage(STATUS_GROUP_LABELS[category]))
      } else {
        parts.push(...inGroup.map((s) => s.name))
      }
    }
    // A slug the workspace no longer has (renamed or deleted status) still
    // filters the feed, so the chip names it.
    parts.push(...picked.filter((slug) => !statuses.some((s) => s.slug === slug)))
    const everything = statuses.length > 0 && statuses.every((s) => picked.includes(s.slug))
    chips.push({
      key: 'status',
      type: 'status',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.status',
        defaultMessage: 'Status:',
      }),
      value: everything
        ? intl.formatMessage({ id: 'portal.feedback.filter.status.all', defaultMessage: 'All' })
        : parts.length <= 2
          ? intl.formatList(parts, { type: 'conjunction' })
          : intl.formatMessage(
              {
                id: 'portal.feedback.filter.status.summaryMore',
                defaultMessage: '{names} +{count}',
              },
              {
                names: intl.formatList(parts.slice(0, 2), { type: 'unit', style: 'short' }),
                count: parts.length - 2,
              }
            ),
      valueId: picked.join(),
      onRemove: () => setFilters({ status: undefined }),
    })
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
      label: votesLabel(intl, t.value),
    }))
    const matched = VOTE_THRESHOLDS.find((t) => t.value === filters.minVotes)
    chips.push({
      key: 'minVotes',
      type: 'votes',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.votes',
        defaultMessage: 'Min votes:',
      }),
      value: matched ? votesLabel(intl, matched.value) : `${filters.minVotes}+`,
      valueId: String(filters.minVotes),
      options: opts,
      onChange: (id) => setFilters({ minVotes: parseInt(id, 10) }),
      onRemove: () => setFilters({ minVotes: undefined }),
    })
  }

  // Created date
  if (filters.dateFrom) {
    const opts: FilterOption[] = DATE_PRESETS.map((p) => ({
      id: p.value,
      label: intl.formatMessage(DATE_PRESET_LABELS[p.value]),
    }))
    const matched = DATE_PRESETS.find((p) => getDateFromDaysAgo(p.daysAgo) === filters.dateFrom)
    chips.push({
      key: 'dateFrom',
      type: 'date',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.date',
        defaultMessage: 'Date:',
      }),
      value: matched ? intl.formatMessage(DATE_PRESET_LABELS[matched.value]) : filters.dateFrom,
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
    const opts: FilterOption[] = RESPONDED_OPTIONS.map((o) => ({
      id: o.value,
      label: intl.formatMessage(RESPONDED_LABELS[o.value]),
    }))
    const matched = RESPONDED_OPTIONS.find((o) => o.value === filters.responded)
    chips.push({
      key: 'responded',
      type: 'response',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.response',
        defaultMessage: 'Team response:',
      }),
      value: matched ? intl.formatMessage(RESPONDED_LABELS[matched.value]) : filters.responded,
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
