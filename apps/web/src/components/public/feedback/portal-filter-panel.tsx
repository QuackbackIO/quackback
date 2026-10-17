import { useId } from 'react'
import { useIntl, type MessageDescriptor } from 'react-intl'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/shared/utils'
import { feedShowsActiveOnly, type PublicFeedView } from '@/lib/shared/types/filters'
import type { PublicFeedbackFilters } from '@/lib/shared/types'
import type { PostStatusEntity, PostTag } from '@/lib/shared/db-types'
import type { PublicPostFacetCounts } from '@/lib/client/hooks/use-portal-posts-query'
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
}

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

function Count({ value }: { value: number | undefined }) {
  if (value === undefined) return null
  return <span className="ms-auto shrink-0 ps-1 text-xs font-semibold tabular-nums">{value}</span>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const headingId = useId()
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="border-t border-border/50 px-3 py-3 first:border-t-0"
    >
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
  // A sibling label (htmlFor) rather than a wrapping one: a button checkbox
  // nested in a label re-dispatches its click and can loop.
  const id = useId()
  return (
    <div className="flex items-center gap-2.5 rounded-md px-1 py-1 text-sm hover:bg-muted/50">
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: status.color }}
          aria-hidden
        />
        <span className="min-w-0 truncate text-foreground">{status.name}</span>
        <Count value={count} />
      </label>
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
}: PortalFilterPanelProps): React.ReactElement {
  const intl = useIntl()

  // The statuses the feed shows right now: the picked ones, or the default
  // scope (active only, or everything while searching).
  // The URL may name statuses by slug or (older links) by id; compare slugs.
  const scope =
    filters.status?.map((value) => statuses.find((s) => s.id === value)?.slug ?? value) ??
    statuses
      .filter((s) => !feedShowsActiveOnly(filters.search) || s.category === 'active')
      .map((s) => s.slug)

  function toggleStatus(slug: string): void {
    const next = scope.includes(slug)
      ? scope.filter((s) => s !== slug)
      : statuses.map((s) => s.slug).filter((s) => s === slug || scope.includes(s))
    setFilters({ status: next.length > 0 ? next : undefined })
  }

  function toggleTag(tagId: string): void {
    const current = filters.tagIds ?? []
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId]
    setFilters({ tagIds: next.length > 0 ? next : undefined })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/50 bg-card shadow-sm">
      {showViews && (
        <Section
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
      )}

      {boards.length > 1 && (
        <Section
          title={intl.formatMessage({
            id: 'portal.feedback.sidebar.boards',
            defaultMessage: 'Boards',
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
                  id: 'portal.feedback.sidebar.viewAllPosts',
                  defaultMessage: 'View all ideas',
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
                <Count value={counts?.boards[board.slug] ?? (counts ? 0 : undefined)} />
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section
        title={intl.formatMessage({
          id: 'portal.feedback.filter.category.status',
          defaultMessage: 'Status',
        })}
      >
        {STATUS_CATEGORY_ORDER.map((category) => {
          const group = statuses.filter((s) => (s.category ?? 'active') === category)
          if (group.length === 0) return null
          return (
            <div key={category} className="mb-1 last:mb-0">
              <p className="px-1 pb-1 pt-1.5 text-[11px] text-muted-foreground">
                {intl.formatMessage(STATUS_GROUP_LABELS[category])}
              </p>
              {group.map((status) => (
                <StatusRow
                  key={status.id}
                  status={status}
                  checked={scope.includes(status.slug)}
                  onToggle={() => toggleStatus(status.slug)}
                  count={counts?.statuses[status.slug] ?? (counts ? 0 : undefined)}
                />
              ))}
            </div>
          )
        })}
      </Section>

      {tags.length > 1 && (
        <Section
          title={intl.formatMessage({ id: 'portal.feedback.panel.tags', defaultMessage: 'Tags' })}
        >
          <div className="flex flex-wrap gap-1.5 px-1">
            {tags.map((tag) => {
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
          </div>
        </Section>
      )}
    </div>
  )
}
