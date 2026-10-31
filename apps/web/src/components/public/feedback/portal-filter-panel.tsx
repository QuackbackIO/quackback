import { useId, useState } from 'react'
import { useIntl, type MessageDescriptor } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import type { PublicFeedView } from '@/lib/shared/types/filters'
import type { PublicFeedbackFilters } from '@/lib/shared/types'
import type { PostStatusEntity, PostTag } from '@/lib/shared/db-types'
import type { PublicPostFacetCounts } from '@/lib/shared/types/filters'
import { MoreButton } from './filter-pill'
import { StatusPills, TagPills } from './filter-pill-groups'

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

/** Boards and tags listed before the rest fold behind "N more". */
const BOARDS_SHOWN = 6
const TAGS_SHOWN = 8

export const VIEW_LABELS: Record<'all' | PublicFeedView, MessageDescriptor> = {
  all: {
    id: 'portal.feedback.panel.view.all',
    defaultMessage:
      '{postWord, select, post {All posts} feature_request {All feature requests} suggestion {All suggestions} other {All ideas}}',
  },
  mine: {
    id: 'portal.feedback.panel.view.mine',
    defaultMessage:
      '{postWord, select, post {My posts} feature_request {My feature requests} suggestion {My suggestions} other {My ideas}}',
  },
  voted: { id: 'portal.feedback.panel.view.voted', defaultMessage: 'Voted' },
  following: { id: 'portal.feedback.panel.view.following', defaultMessage: 'Following' },
}

export const rowClass = (active: boolean) =>
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

export function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
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
  const [allBoardsShown, setAllBoardsShown] = useState(false)
  const [allTagsShown, setAllTagsShown] = useState(false)
  const group = {
    filters,
    setFilters,
    size: layout === 'sheet' ? ('md' as const) : ('sm' as const),
  }

  const showSection = showViews && (
    <PanelSection
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
    </PanelSection>
  )

  // The picked board stays listed when it is one of the folded ones.
  const shownBoards = allBoardsShown
    ? boards
    : boards.filter((board, i) => i < BOARDS_SHOWN || board.slug === filters.board)
  const boardSection = boards.length > 1 && (
    <PanelSection
      key="boards"
      title={intl.formatMessage({
        id: 'portal.feedback.sidebar.boards',
        defaultMessage: '{boardWord, select, category {Categories} other {Boards}}',
      })}
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
              defaultMessage: '{boardWord, select, category {All categories} other {All boards}}',
            })}
          </span>
        </button>
        {shownBoards.map((board) => (
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
        {boards.length > shownBoards.length && (
          <MoreButton
            hidden={boards.length - shownBoards.length}
            onClick={() => setAllBoardsShown(true)}
            className="py-1.5"
          />
        )}
      </div>
    </PanelSection>
  )

  const statusSection = (
    <PanelSection
      key="status"
      title={intl.formatMessage({
        id: 'portal.feedback.filter.category.status',
        defaultMessage: 'Status',
      })}
    >
      <div className="flex flex-wrap gap-1.5 px-1">
        <StatusPills {...group} statuses={statuses} counts={counts?.statuses} />
      </div>
    </PanelSection>
  )

  // Once the counts are in, tags on no visible post drop out (a picked tag
  // stays, so it can be unpicked).
  const usableTags = tags.filter(
    (tag) => !counts || (counts.tags[tag.id] ?? 0) > 0 || filters.tagIds?.includes(tag.id)
  )
  const shownTags = allTagsShown ? usableTags : usableTags.slice(0, TAGS_SHOWN)
  const tagSection = usableTags.length > 1 && (
    <PanelSection
      key="tags"
      title={intl.formatMessage({ id: 'portal.postDetail.metadata.tags', defaultMessage: 'Tags' })}
    >
      <div className="flex flex-wrap gap-1.5 px-1">
        <TagPills {...group} tags={shownTags} />
        {usableTags.length > shownTags.length && (
          <MoreButton
            hidden={usableTags.length - shownTags.length}
            onClick={() => setAllTagsShown(true)}
          />
        )}
      </div>
    </PanelSection>
  )

  const sections =
    layout === 'sheet'
      ? [showSection, statusSection, boardSection, tagSection]
      : [showSection, boardSection, statusSection, tagSection]

  return (
    <div
      className={cn(
        'divide-y divide-border/50',
        // In the sidebar the card chrome sits on the scroll area around it.
        layout === 'sheet' && 'overflow-hidden rounded-lg border border-border/50 bg-card shadow-sm'
      )}
    >
      {sections}
      {footer}
    </div>
  )
}
