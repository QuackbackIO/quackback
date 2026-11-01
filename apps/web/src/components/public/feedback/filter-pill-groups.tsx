import { useState } from 'react'
import { useIntl } from 'react-intl'
import type { PublicFeedbackFilters, TeamMember } from '@/lib/shared/types'
import { PUBLIC_FEED_VIEWS, type PublicFeedView } from '@/lib/shared/types/filters'
import type { PostStatusEntity, PostTag } from '@/lib/shared/db-types'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'
import { toggleItem } from '@/components/shared/filter-utils'
import {
  DATE_PRESETS,
  RESPONDED_OPTIONS,
  STATUS_CATEGORY_ORDER,
  getDateFromDaysAgo,
  type RespondedValue,
} from './public-filters-bar-defaults'
import { FilterPill, MoreButton } from './filter-pill'

/**
 * The pills for each portal filter, shared by the panel, More filters and
 * the editor a chip above the feed opens, so a filter looks and behaves the
 * same wherever it is changed. A one-pick group clears when its lit pill is
 * clicked again; a many-pick group toggles each pill.
 */

type SetFilters = (updates: Partial<PublicFeedbackFilters>) => void

/** A pill's post count. Zero shows nothing: the pill is still there to pick. */
function useCountText(): (value: number | undefined) => string | undefined {
  const intl = useIntl()
  return (value) => (value ? intl.formatNumber(value) : undefined)
}

interface GroupProps {
  filters: PublicFeedbackFilters
  setFilters: SetFilters
  size?: 'sm' | 'md'
}

/** Owners listed before the rest fold behind "N more". */
const OWNERS_SHOWN = 8
/** The date and vote steps offered as pills (Today stays a URL-only value). */
export const PANEL_DATE_PRESETS = DATE_PRESETS.filter((p) => p.daysAgo > 0)
export const PANEL_VOTE_THRESHOLDS = [10, 50, 100] as const

const VIEW_LABELS = {
  mine: {
    id: 'portal.feedback.panel.view.mine',
    defaultMessage:
      '{postWord, select, post {My posts} feature_request {My feature requests} suggestion {My suggestions} other {My ideas}}',
  },
  voted: { id: 'portal.feedback.panel.view.voted', defaultMessage: 'Voted' },
  following: { id: 'portal.feedback.panel.view.following', defaultMessage: 'Following' },
} as const

export const RESPONDED_LABELS: Record<RespondedValue, { id: string; defaultMessage: string }> = {
  responded: { id: 'portal.feedback.filter.response.responded', defaultMessage: 'Replied' },
  unresponded: {
    id: 'portal.feedback.filter.response.unresponded',
    defaultMessage: 'Awaiting reply',
  },
}

/**
 * A lit pill is a status the visitor picked. With none lit the feed shows its
 * default scope, so the first pick narrows to that status and later picks add
 * to it. The URL may name statuses by slug or (older links) by id.
 */
export function StatusPills({
  filters,
  setFilters,
  size,
  statuses,
  counts,
}: GroupProps & { statuses: PostStatusEntity[]; counts?: Record<string, number> }) {
  const countText = useCountText()
  const picked =
    filters.status?.map((value) => statuses.find((s) => s.id === value)?.slug ?? value) ?? []
  const ordered = STATUS_CATEGORY_ORDER.flatMap((category) =>
    statuses.filter((s) => (s.category ?? 'active') === category)
  )

  function toggle(slug: string): void {
    const next = picked.includes(slug) ? picked.filter((s) => s !== slug) : [...picked, slug]
    const inOrder = statuses.map((s) => s.slug).filter((s) => next.includes(s))
    setFilters({ status: inOrder.length > 0 ? inOrder : undefined })
  }

  return ordered.map((status) => (
    <FilterPill
      key={status.id}
      pressed={picked.includes(status.slug)}
      onClick={() => toggle(status.slug)}
      color={status.color}
      count={countText(counts?.[status.slug])}
      size={size}
      title={status.name}
    >
      {status.name}
    </FilterPill>
  ))
}

export function TagPills({ filters, setFilters, size, tags }: GroupProps & { tags: PostTag[] }) {
  return tags.map((tag) => (
    <FilterPill
      key={tag.id}
      pressed={filters.tagIds?.includes(tag.id) ?? false}
      onClick={() => {
        const next = toggleItem(filters.tagIds, tag.id)
        setFilters({ tagIds: next?.length ? next : undefined })
      }}
      color={tag.color}
      dot="square"
      size={size}
      title={tag.name}
    >
      {tag.name}
    </FilterPill>
  ))
}

export function BoardPills({
  filters,
  setFilters,
  size,
  boards,
  counts,
}: GroupProps & {
  boards: { id: string; slug: string; name: string }[]
  counts?: Record<string, number>
}) {
  const countText = useCountText()
  return boards.map((board) => (
    <FilterPill
      key={board.id}
      pressed={filters.board === board.slug}
      onClick={() => setFilters({ board: filters.board === board.slug ? undefined : board.slug })}
      count={countText(counts?.[board.slug])}
      size={size}
      title={board.name}
    >
      {board.name}
    </FilterPill>
  ))
}

export function ViewPills({
  filters,
  setFilters,
  size,
  counts,
}: GroupProps & { counts?: Record<PublicFeedView, number> | null }) {
  const intl = useIntl()
  const countText = useCountText()
  return PUBLIC_FEED_VIEWS.map((view) => (
    <FilterPill
      key={view}
      pressed={filters.view === view}
      onClick={() => setFilters({ view: filters.view === view ? undefined : view })}
      count={countText(counts?.[view])}
      size={size}
    >
      {intl.formatMessage(VIEW_LABELS[view])}
    </FilterPill>
  ))
}

export function ResponsePills({ filters, setFilters, size }: GroupProps) {
  const intl = useIntl()
  return RESPONDED_OPTIONS.map(({ value }) => (
    <FilterPill
      key={value}
      size={size}
      pressed={filters.responded === value}
      onClick={() => setFilters({ responded: filters.responded === value ? undefined : value })}
    >
      {intl.formatMessage(RESPONDED_LABELS[value])}
    </FilterPill>
  ))
}

export function DatePills({ filters, setFilters, size }: GroupProps) {
  const intl = useIntl()
  const picked = DATE_PRESETS.find((p) => getDateFromDaysAgo(p.daysAgo) === filters.dateFrom)
  return PANEL_DATE_PRESETS.map((preset) => (
    <FilterPill
      key={preset.value}
      size={size}
      pressed={picked?.value === preset.value}
      onClick={() =>
        setFilters({
          dateFrom: picked?.value === preset.value ? undefined : getDateFromDaysAgo(preset.daysAgo),
        })
      }
    >
      {intl.formatMessage(
        {
          id: 'portal.feedback.filter.date.days',
          defaultMessage: '{count, plural, one {# day} other {# days}}',
        },
        { count: preset.daysAgo }
      )}
    </FilterPill>
  ))
}

export function VotePills({ filters, setFilters, size }: GroupProps) {
  const intl = useIntl()
  return PANEL_VOTE_THRESHOLDS.map((value) => (
    <FilterPill
      key={value}
      size={size}
      pressed={filters.minVotes === value}
      onClick={() => setFilters({ minVotes: filters.minVotes === value ? undefined : value })}
    >
      {intl.formatNumber(value)}+
    </FilterPill>
  ))
}

export function OwnerPills({
  filters,
  setFilters,
  size,
  members,
}: GroupProps & { members: TeamMember[] }) {
  const intl = useIntl()
  const [allShown, setAllShown] = useState(false)
  const shown = allShown
    ? members
    : members.filter((m, i) => i < OWNERS_SHOWN || m.id === filters.owner)
  const options = [
    {
      id: 'unassigned',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.owner.unassigned',
        defaultMessage: 'Unassigned',
      }),
    },
    ...shown.map((m) => ({ id: m.id, label: m.name || m.email || m.id })),
  ]
  return (
    <>
      {options.map(({ id, label }) => (
        <FilterPill
          key={id}
          size={size}
          title={label}
          pressed={filters.owner === id}
          onClick={() => setFilters({ owner: filters.owner === id ? undefined : id })}
        >
          {label}
        </FilterPill>
      ))}
      {members.length > shown.length && (
        <MoreButton hidden={members.length - shown.length} onClick={() => setAllShown(true)} />
      )}
    </>
  )
}

export function SegmentPills({
  filters,
  setFilters,
  size,
  segments,
}: GroupProps & { segments: SegmentListItem[] }) {
  return segments.map((segment) => (
    <FilterPill
      key={segment.id}
      size={size}
      color={segment.color}
      title={segment.name}
      pressed={filters.segmentIds?.includes(segment.id) ?? false}
      onClick={() => {
        const next = toggleItem(filters.segmentIds, segment.id)
        setFilters({ segmentIds: next?.length ? next : undefined })
      }}
    >
      {segment.name}
    </FilterPill>
  ))
}
