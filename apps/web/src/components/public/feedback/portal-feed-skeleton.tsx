import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { sortForSearch } from '@/lib/shared/types/filters'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
import { FeedbackHeaderFallback } from './feedback-header'
import { FeedbackToolbar } from './feedback-toolbar'
import { FeedbackSidebar } from './feedback-sidebar'
import { PortalFilterSheet } from './portal-filter-sheet'
import { PanelSection, VIEW_LABELS, rowClass } from './portal-filter-panel'
import { PublicMoreFilters } from './public-filters-bar'
import { usePublicFilters } from './use-public-filters'
import { useFeedHandoff } from './feed-input-handoff'

/** One placeholder bar, sized like the text it stands in for. */
function Bone({ className }: { className?: string }) {
  return <div className={cn('rounded bg-muted animate-pulse', className)} />
}

/** Title, body and tag widths per card, so the rows don't read as a stamp. */
const CARD_WIDTHS = [
  ['w-3/5', 'w-4/5', 'w-24'],
  ['w-2/5', 'w-3/4', 'w-16'],
  ['w-1/2', 'w-2/3', 'w-28'],
  ['w-3/5', 'w-3/5', 'w-20'],
  ['w-1/3', 'w-4/5', 'w-24'],
] as const

const BOARD_WIDTHS = ['w-20', 'w-28', 'w-24', 'w-32', 'w-24', 'w-28']
const PILL_WIDTHS = ['w-16', 'w-24', 'w-20', 'w-24', 'w-20', 'w-16']

/** A post card's outline and rhythm: vote box, status, title, body, tags, author. */
function CardSkeleton({ widths }: { widths: readonly [string, string, string] }) {
  const [title, body, tags] = widths
  return (
    <div className="overflow-hidden rounded-lg border border-border/40 bg-card shadow-sm">
      <div className="flex items-start gap-4 p-4">
        <div className="flex h-14 w-12 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-border">
          <Bone className="h-1.5 w-2.5" />
          <Bone className="h-3.5 w-6" />
        </div>
        <div className="min-w-0 flex-1 py-1">
          <Bone className="h-3 w-16" />
          <Bone className={cn('mt-3 h-4', title)} />
          <Bone className={cn('mt-3 h-3.5', body)} />
          <Bone className={cn('mt-3 h-3.5', tags)} />
          <Bone className="mt-3 h-3 w-36" />
        </div>
      </div>
    </div>
  )
}

/**
 * The filter panel without its data: the section headings, "All boards" and
 * the views are the real controls; the boards, statuses and tags they list
 * are bars.
 */
function PanelSkeleton({ layout }: { layout: 'sidebar' | 'sheet' }) {
  const intl = useIntl()
  const { filters, setFilters } = usePublicFilters()
  const session = useSessionContext()
  const signedIn = !!session?.user && session.user.principalType !== 'anonymous'

  const show = signedIn && (
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
            </button>
          )
        })}
      </div>
    </PanelSection>
  )
  const boards = (
    <PanelSection
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
        {BOARD_WIDTHS.map((width, i) => (
          <div key={i} className="flex h-8 items-center px-3">
            <Bone className={cn('h-3.5', width)} />
          </div>
        ))}
      </div>
    </PanelSection>
  )
  const pills = (count: number) => (
    <div className="flex flex-wrap gap-1.5 px-1">
      {PILL_WIDTHS.slice(0, count).map((width, i) => (
        <Bone key={i} className={cn('rounded-full', layout === 'sheet' ? 'h-9' : 'h-7', width)} />
      ))}
    </div>
  )
  const statuses = (
    <PanelSection
      key="status"
      title={intl.formatMessage({
        id: 'portal.feedback.filter.category.status',
        defaultMessage: 'Status',
      })}
    >
      {pills(6)}
    </PanelSection>
  )
  const tags = (
    <PanelSection
      key="tags"
      title={intl.formatMessage({ id: 'portal.postDetail.metadata.tags', defaultMessage: 'Tags' })}
    >
      {pills(5)}
    </PanelSection>
  )

  return (
    <div
      className={cn(
        'divide-y divide-border/50',
        layout === 'sheet' && 'overflow-hidden rounded-lg border border-border/50 bg-card shadow-sm'
      )}
    >
      {layout === 'sheet' ? [show, statuses, boards, tags] : [show, boards, statuses, tags]}
      <PublicMoreFilters
        filters={filters}
        setFilters={setFilters}
        size={layout === 'sheet' ? 'md' : 'sm'}
      />
    </div>
  )
}

/**
 * The compose card while the feed loads. It takes typing; when the feed
 * arrives the real composer opens with the title (or just opens, for a
 * visitor who only clicked in).
 */
function LoadingComposer() {
  const [title, setTitle] = useState('')
  const touched = useRef(false)
  const handoff = useFeedHandoff()
  const titleRef = useRef(title)
  useEffect(() => {
    titleRef.current = title
  })
  useEffect(
    () => () => {
      if (touched.current) handoff?.handOff({ composeTitle: titleRef.current })
    },
    [handoff]
  )
  return (
    <FeedbackHeaderFallback
      title={title}
      onTitleChange={setTitle}
      onFocus={() => {
        touched.current = true
      }}
    />
  )
}

/**
 * The portal feed while its streamed data resolves. Everything that doesn't
 * wait on that data is the real thing, and works: the compose card, sorting,
 * search, the Filters button and the panel's headings. Only the posts and
 * the boards, statuses and tags stand in as bars, laid out like the loaded
 * page so it swaps in without moving.
 */
export function PortalFeedSkeleton({ poweredBy }: { poweredBy?: React.ReactNode }) {
  const { filters, setFilters, activeFilterCount } = usePublicFilters()
  const sort = filters.sort ?? 'trending'

  return (
    <div>
      <div className="flex gap-6 lg:gap-8">
        <div className="min-w-0 flex-1">
          <LoadingComposer />
          <FeedbackToolbar
            currentSort={sort}
            onSortChange={(next) => setFilters({ sort: next })}
            currentSearch={filters.search}
            handOffSearch
            onSearchChange={(search) =>
              setFilters({
                search: search || undefined,
                sort: sortForSearch(sort, filters.search, search, 'trending'),
              })
            }
            filterButton={
              <div className="lg:hidden">
                <PortalFilterSheet activeCount={activeFilterCount} footer={poweredBy}>
                  <PanelSkeleton layout="sheet" />
                </PortalFilterSheet>
              </div>
            }
          />
          <div className="mt-5 space-y-3" aria-hidden="true" data-testid="portal-feed-skeleton">
            {CARD_WIDTHS.map((widths, i) => (
              <CardSkeleton key={i} widths={widths} />
            ))}
          </div>
        </div>
        <FeedbackSidebar footer={poweredBy}>
          <PanelSkeleton layout="sidebar" />
        </FeedbackSidebar>
      </div>
    </div>
  )
}
