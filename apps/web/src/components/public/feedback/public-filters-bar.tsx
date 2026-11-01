import { useId, useMemo, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import {
  Squares2X2Icon,
  TagIcon,
  CalendarIcon,
  ArrowTrendingUpIcon,
  ChatBubbleLeftRightIcon,
  UserIcon,
  UserGroupIcon,
  ChevronDownIcon,
  EyeIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { usePortalPermissions } from '@/lib/client/hooks/use-portal-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { useTeamMembers } from '@/lib/client/hooks/use-team-members'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import type { TeamMember } from '@/lib/shared/types'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'
import { FilterChip } from '@/components/shared/filter-chip'
import type { PublicFeedbackFilters } from '@/lib/shared/types'
import type { PostStatusEntity, PostTag } from '@/lib/shared/db-types'
import type { PublicPostFacetCounts } from '@/lib/shared/types/filters'
import { CircleIcon } from '@/components/shared/filter-menu'
import {
  DATE_PRESETS,
  RESPONDED_OPTIONS,
  getDateFromDaysAgo,
  type DatePresetValue,
  STATUS_CATEGORY_ORDER,
  STATUS_GROUP_LABELS,
} from './public-filters-bar-defaults'
import {
  BoardPills,
  DatePills,
  OwnerPills,
  RESPONDED_LABELS,
  ResponsePills,
  SegmentPills,
  StatusPills,
  TagPills,
  ViewPills,
  VotePills,
} from './filter-pill-groups'

interface FilterBarBoard {
  id: string
  slug: string
  name: string
}

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
  /** The feed's counts, shown on the pills a chip opens. */
  counts?: PublicPostFacetCounts | null
}

export function PublicFiltersBar({
  filters,
  setFilters,
  clearFilters,
  statuses,
  tags,
  boards,
  counts,
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
        counts,
        members,
        segments,
        intl,
      }),
    [filters, setFilters, statuses, tags, boards, counts, members, segments, intl]
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

interface MoreFiltersProps {
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  /** Bigger pills in the phone sheet. */
  size?: 'sm' | 'md'
}

function MoreGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p className="px-1 pb-1.5 text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5 px-1">{children}</div>
    </div>
  )
}

/**
 * The less common filters (team response, date and votes, plus owner and
 * segment for the team) folded under "More filters" at the foot of the
 * panel. It starts open when one of them is on, so nothing applied hides.
 * Each group holds one pick; picking the lit pill again clears it.
 */
export function PublicMoreFilters({ filters, setFilters, size = 'sm' }: MoreFiltersProps) {
  const intl = useIntl()
  const contentId = useId()
  const { members, segments } = useTeamOnlyFilterOptions()
  const onCount =
    [filters.responded, filters.dateFrom, filters.minVotes, filters.owner].filter(Boolean).length +
    (filters.segmentIds?.length ? 1 : 0)
  const [open, setOpen] = useState(onCount > 0)
  const group = { filters, setFilters, size }

  return (
    <div className="px-3 py-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-1 py-2 text-sm font-medium text-foreground/80 hover:text-foreground"
      >
        {intl.formatMessage({ id: 'portal.feedback.filter.more', defaultMessage: 'More filters' })}
        {onCount > 0 && (
          <span className="rounded-full bg-foreground px-1.5 text-[11px] font-semibold leading-4 text-background tabular-nums">
            {onCount}
          </span>
        )}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            'ms-auto size-3.5 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && (
        <div id={contentId} className="space-y-3 pb-3 pt-1">
          <MoreGroup
            label={intl.formatMessage({
              id: 'portal.feedback.filter.category.response',
              defaultMessage: 'Team response',
            })}
          >
            <ResponsePills {...group} />
          </MoreGroup>
          <MoreGroup
            label={intl.formatMessage({
              id: 'portal.feedback.filter.date.postedWithin',
              defaultMessage: 'Posted in the last',
            })}
          >
            <DatePills {...group} />
          </MoreGroup>
          <MoreGroup
            label={intl.formatMessage({
              id: 'portal.feedback.filter.category.votes',
              defaultMessage: 'Vote count',
            })}
          >
            <VotePills {...group} />
          </MoreGroup>
          {(members.length > 0 || segments.length > 0) && (
            <div className="space-y-3 rounded-lg bg-amber-50 p-2 dark:bg-amber-500/10">
              <p className="px-1 text-xs font-medium text-amber-800 dark:text-amber-400">
                {intl.formatMessage({
                  id: 'portal.feedback.filter.internal.tooltip',
                  defaultMessage: 'Only your team sees this',
                })}
              </p>
              {members.length > 0 && (
                <MoreGroup
                  label={intl.formatMessage({
                    id: 'portal.feedback.filter.category.owner',
                    defaultMessage: 'Owner',
                  })}
                >
                  <OwnerPills {...group} members={members} />
                </MoreGroup>
              )}
              {segments.length > 0 && (
                <MoreGroup
                  label={intl.formatMessage({
                    id: 'portal.feedback.filter.category.segment',
                    defaultMessage: 'Segment',
                  })}
                >
                  <SegmentPills {...group} segments={segments} />
                </MoreGroup>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface ActiveChipDescriptor {
  key: string
  type: ChipType
  label: string
  value: string
  valueId: string
  color?: string
  /** The pills that change this filter, opened by clicking the chip. */
  editor: React.ReactNode
  onRemove: () => void
  /** Team-only chip: amber styling. */
  internal?: boolean
  /** Localized "only your team sees this" tooltip for internal chips. */
  tooltip?: string
}

/** Names up to two picks, then "A, B +n". */
function summarize(intl: IntlShape, names: string[]): string {
  return names.length <= 2
    ? intl.formatList(names, { type: 'conjunction' })
    : intl.formatMessage(
        { id: 'portal.feedback.filter.status.summaryMore', defaultMessage: '{names} +{count}' },
        {
          names: intl.formatList(names.slice(0, 2), { type: 'unit', style: 'short' }),
          count: names.length - 2,
        }
      )
}

/**
 * One chip per applied filter. Clicking a chip opens the same pills the panel
 * uses for that filter, so it can be changed without leaving the feed.
 */
function buildActiveChips(args: {
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  statuses: PostStatusEntity[]
  tags: PostTag[]
  boards: FilterBarBoard[]
  counts?: PublicPostFacetCounts | null
  members: TeamMember[]
  segments: SegmentListItem[]
  intl: IntlShape
}): ActiveChipDescriptor[] {
  const { filters, setFilters, statuses, tags, boards, counts, members, segments, intl } = args
  const chips: ActiveChipDescriptor[] = []
  const group = { filters, setFilters }

  // View chip (My ideas, Voted, Following), so the view is never hidden in
  // the panel alone.
  if (filters.view) {
    const viewLabels = {
      mine: intl.formatMessage({
        id: 'portal.feedback.panel.view.mine',
        defaultMessage:
          '{postWord, select, post {My posts} feature_request {My feature requests} suggestion {My suggestions} other {My ideas}}',
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
      editor: <ViewPills {...group} counts={counts?.views} />,
      onRemove: () => setFilters({ view: undefined }),
    })
  }

  // Board chip — only shown when a specific board is selected (omit for
  // "All Posts").
  if (filters.board && boards.length > 1) {
    const board = boards.find((b) => b.slug === filters.board)
    if (board) {
      chips.push({
        key: 'board',
        type: 'board',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.chip.board',
          defaultMessage: '{boardWord, select, category {Category:} other {Board:}}',
        }),
        value: board.name,
        valueId: board.slug,
        editor: <BoardPills {...group} boards={boards} counts={counts?.boards} />,
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
      const inCategory = statuses.filter((s) => (s.category ?? 'active') === category)
      const inGroup = inCategory.filter((s) => picked.includes(s.slug))
      if (inCategory.length > 1 && inGroup.length === inCategory.length) {
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
        : summarize(intl, parts),
      valueId: picked.join(),
      editor: <StatusPills {...group} statuses={statuses} counts={counts?.statuses} />,
      onRemove: () => setFilters({ status: undefined }),
    })
  }

  // Tags: one chip naming the picks.
  if (filters.tagIds?.length) {
    const names = filters.tagIds
      .map((id) => tags.find((t) => t.id === id)?.name)
      .filter((n): n is string => !!n)
    chips.push({
      key: 'tags',
      type: 'tags',
      label:
        filters.tagIds.length === 1
          ? intl.formatMessage({ id: 'portal.feedback.filter.chip.tag', defaultMessage: 'Tag:' })
          : intl.formatMessage({ id: 'portal.feedback.filter.chip.tags', defaultMessage: 'Tags:' }),
      value: summarize(intl, names),
      valueId: filters.tagIds.join(),
      editor: <TagPills {...group} tags={tags} />,
      onRemove: () => setFilters({ tagIds: undefined }),
    })
  }

  // Vote count
  if (filters.minVotes) {
    chips.push({
      key: 'minVotes',
      type: 'votes',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.votes',
        defaultMessage: 'Min votes:',
      }),
      value: `${intl.formatNumber(filters.minVotes)}+`,
      valueId: String(filters.minVotes),
      editor: <VotePills {...group} />,
      onRemove: () => setFilters({ minVotes: undefined }),
    })
  }

  // Created date
  if (filters.dateFrom) {
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
      editor: <DatePills {...group} />,
      onRemove: () => setFilters({ dateFrom: undefined }),
    })
  }

  // Team response
  if (filters.responded) {
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
      editor: <ResponsePills {...group} />,
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
    const ownerValue =
      filters.owner === 'unassigned'
        ? intl.formatMessage({
            id: 'portal.feedback.filter.owner.unassigned',
            defaultMessage: 'Unassigned',
          })
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
      editor: <OwnerPills {...group} members={members} />,
      internal: true,
      tooltip: internalTooltip,
      onRemove: () => setFilters({ owner: undefined }),
    })
  }

  // Segments: one chip naming the picks.
  if (filters.segmentIds?.length && segments.length > 0) {
    const picked = segments.filter((s) => filters.segmentIds?.includes(s.id))
    if (picked.length > 0) {
      chips.push({
        key: 'segments',
        type: 'segment',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.chip.segment',
          defaultMessage: 'Segment:',
        }),
        value: summarize(
          intl,
          picked.map((s) => s.name)
        ),
        valueId: filters.segmentIds.join(),
        color: picked.length === 1 ? picked[0].color : undefined,
        editor: <SegmentPills {...group} segments={segments} />,
        internal: true,
        tooltip: internalTooltip,
        onRemove: () => setFilters({ segmentIds: undefined }),
      })
    }
  }

  return chips
}
