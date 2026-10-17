import { useId, useState } from 'react'
import { useIntl, type MessageDescriptor } from 'react-intl'
import { CheckIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import type { PublicFeedView } from '@/lib/shared/types/filters'
import type { PublicFeedbackFilters } from '@/lib/shared/types'
import type { PostStatusEntity, PostTag } from '@/lib/shared/db-types'
import type { PublicPostFacetCounts } from '@/lib/shared/types/filters'
import { STATUS_CATEGORY_ORDER } from './public-filters-bar-defaults'

interface PanelBoard {
  id: string
  slug: string
  name: string
}

interface PortalFilterPanelProps {
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  boards: PanelBoard[]
  statuses: PostStatusEntity[]
  tags: PostTag[]
  /** Undefined while the counts load; the panel renders without them. */
  counts?: PublicPostFacetCounts | null
  /** Signed-in (non-anonymous) viewers get the Show section. */
  showViews: boolean
  /** The phone sheet puts Status before the board list. */
  layout?: 'sidebar' | 'sheet'
  /** Rendered at the foot of the panel (the less common filters). */
  footer?: React.ReactNode
}

/** Tags listed before the rest fold behind "N more". */
const TAGS_SHOWN = 12

const VIEW_LABELS: Record<'all' | PublicFeedView, MessageDescriptor> = {
  all: { id: 'portal.feedback.panel.view.all', defaultMessage: 'All ideas' },
  mine: { id: 'portal.feedback.panel.view.mine', defaultMessage: 'My ideas' },
  voted: { id: 'portal.feedback.panel.view.voted', defaultMessage: 'Voted' },
  following: { id: 'portal.feedback.panel.view.following', defaultMessage: 'Following' },
}

const STATUS_GROUP_LABELS: Record<(typeof STATUS_CATEGORY_ORDER)[number], MessageDescriptor> = {
  active: { id: 'portal.feedback.filter.statusGroup.active', defaultMessage: 'Active' },
  complete: { id: 'portal.feedback.filter.statusGroup.complete', defaultMessage: 'Complete' },
  closed: { id: 'portal.feedback.filter.statusGroup.closed', defaultMessage: 'Closed' },
}

const rowClass = (active: boolean) =>
  cn(
    'flex w-full max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-start text-sm transition-colors',
    active
      ? 'bg-muted font-medium text-foreground'
      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
  )

/** A row's post count. Zero shows nothing: the row is still there to pick. */
function Count({ value }: { value: number | undefined }) {
  const intl = useIntl()
  if (!value) return null
  return (
    <span className="ms-auto shrink-0 ps-1 text-xs text-muted-foreground tabular-nums">
      {intl.formatNumber(value)}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const headingId = useId()
  return (
    <div role="group" aria-labelledby={headingId} className="px-3 py-3">
      <h2
        id={headingId}
        className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {title}
      </h2>
      {children}
    </div>
  )
}

function StatusGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} className="mb-1 last:mb-0">
      <p id={labelId} className="px-1 pb-1 pt-1.5 text-xs text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  )
}

function StatusRow({
  status,
  checked,
  onToggle,
  count,
}: {
  status: PostStatusEntity
  checked: boolean
  onToggle: () => void
  count: number | undefined
}) {
  // A plain checkbox-role button: the whole row toggles, and it renders far
  // less markup per status than the Base UI checkbox (the portal page weight
  // budget counts every byte of this panel).
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-start text-sm hover:bg-muted/50"
    >
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
          checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/60'
        )}
      >
        {checked && <CheckIcon className="size-3" />}
      </span>
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: status.color }}
        aria-hidden
      />
      <span className="min-w-0 truncate text-foreground">{status.name}</span>
      <Count value={count} />
    </button>
  )
}

/**
 * The portal feed's filters with live counts: views, boards, statuses and
 * tags. One component, mounted in the desktop sidebar and the phone sheet.
 * A section only renders when it has a choice to offer.
 */
export function PortalFilterPanel({
  filters,
  setFilters,
  boards,
  statuses,
  tags,
  counts,
  showViews,
  layout = 'sidebar',
  footer,
}: PortalFilterPanelProps): React.ReactElement {
  const intl = useIntl()
  const [allTagsShown, setAllTagsShown] = useState(false)

  // The statuses picked. None picked means the default scope, which the
  // status chip names, so nothing is ticked.
  // The URL may name statuses by slug or (older links) by id; compare slugs.
  const picked =
    filters.status?.map((value) => statuses.find((s) => s.id === value)?.slug ?? value) ?? []

  function toggleStatus(slug: string): void {
    const next = picked.includes(slug)
      ? picked.filter((s) => s !== slug)
      : statuses.map((s) => s.slug).filter((s) => s === slug || picked.includes(s))
    setFilters({ status: next.length > 0 ? next : undefined })
  }

  function toggleTag(tagId: string): void {
    const current = filters.tagIds ?? []
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId]
    setFilters({ tagIds: next.length > 0 ? next : undefined })
  }

  const showSection = showViews && (
    <Section
      key="show"
      title={intl.formatMessage({ id: 'portal.feedback.panel.show', defaultMessage: 'Show' })}
    >
      <div className="space-y-1">
        {(['all', 'mine', 'voted', 'following'] as const).map((view) => {
          const active = (filters.view ?? 'all') === view
          return (
            <button
              key={view}
              type="button"
              aria-pressed={active}
              onClick={() => setFilters({ view: view === 'all' ? undefined : view })}
              className={rowClass(active)}
            >
              <span className="truncate">{intl.formatMessage(VIEW_LABELS[view])}</span>
              {view !== 'all' && <Count value={counts?.views?.[view]} />}
            </button>
          )
        })}
      </div>
    </Section>
  )

  const boardSection = boards.length > 1 && (
    <Section
      key="boards"
      title={intl.formatMessage({ id: 'portal.feedback.sidebar.boards', defaultMessage: 'Boards' })}
    >
      <div className="space-y-1">
        <button
          type="button"
          aria-pressed={!filters.board}
          onClick={() => setFilters({ board: undefined })}
          className={rowClass(!filters.board)}
        >
          <span className="truncate">
            {intl.formatMessage({
              id: 'portal.feedback.panel.allBoards',
              defaultMessage: 'All boards',
            })}
          </span>
        </button>
        {boards.map((board) => (
          <button
            key={board.id}
            type="button"
            aria-pressed={filters.board === board.slug}
            onClick={() => setFilters({ board: board.slug })}
            className={rowClass(filters.board === board.slug)}
          >
            <span className="min-w-0 truncate">{board.name}</span>
            <Count value={counts?.boards[board.slug]} />
          </button>
        ))}
      </div>
    </Section>
  )

  const statusSection = (
    <Section
      key="status"
      title={intl.formatMessage({
        id: 'portal.feedback.filter.category.status',
        defaultMessage: 'Status',
      })}
    >
      {STATUS_CATEGORY_ORDER.map((category) => {
        const group = statuses.filter((s) => (s.category ?? 'active') === category)
        if (group.length === 0) return null
        return (
          <StatusGroup key={category} label={intl.formatMessage(STATUS_GROUP_LABELS[category])}>
            {group.map((status) => (
              <StatusRow
                key={status.id}
                status={status}
                checked={picked.includes(status.slug)}
                onToggle={() => toggleStatus(status.slug)}
                count={counts?.statuses[status.slug]}
              />
            ))}
          </StatusGroup>
        )
      })}
    </Section>
  )

  // Once the counts are in, tags on no visible post drop out (a picked tag
  // stays, so it can be unpicked).
  const usableTags = tags.filter(
    (tag) => !counts || (counts.tags[tag.id] ?? 0) > 0 || filters.tagIds?.includes(tag.id)
  )
  const shownTags = allTagsShown ? usableTags : usableTags.slice(0, TAGS_SHOWN)
  const tagSection = usableTags.length > 1 && (
    <Section
      key="tags"
      title={intl.formatMessage({ id: 'portal.postDetail.metadata.tags', defaultMessage: 'Tags' })}
    >
      <div className="flex flex-wrap gap-1.5 px-1">
        {shownTags.map((tag) => {
          const active = filters.tagIds?.includes(tag.id) ?? false
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={active}
              onClick={() => toggleTag(tag.id)}
              className="rounded px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: tag.color + (active ? '40' : '1a'),
                color: tag.color,
                boxShadow: active ? `inset 0 0 0 1px ${tag.color}` : undefined,
              }}
            >
              {tag.name}
            </button>
          )
        })}
        {usableTags.length > shownTags.length && (
          <button
            type="button"
            onClick={() => setAllTagsShown(true)}
            className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            {intl.formatMessage(
              { id: 'portal.feedback.panel.moreTags', defaultMessage: '{count} more' },
              { count: usableTags.length - shownTags.length }
            )}
          </button>
        )}
      </div>
    </Section>
  )

  const sections =
    layout === 'sheet'
      ? [showSection, statusSection, boardSection, tagSection]
      : [showSection, boardSection, statusSection, tagSection]

  return (
    <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50 bg-card shadow-sm">
      {sections}
      {footer && <div className="px-4 py-3">{footer}</div>}
    </div>
  )
}
