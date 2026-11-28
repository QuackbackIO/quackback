import type { IntlShape } from 'react-intl'
import { useOptionalIntl } from '@/components/ui/use-optional-intl'
import { nameInitial } from '@/lib/shared/utils/initial'
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { hasConversationsFn } from '@/lib/server/functions/onboarding-progress'
import { conversationInboxQueries } from '@/lib/client/queries/conversation-inbox'
import { inboxQueries } from '@/lib/client/queries/inbox'
import type {
  ConversationDTO,
  ConversationPriority,
  Channel,
} from '@/lib/shared/conversation/types'
import {
  inboxItemRefFromId,
  type InboxItemDTO,
  type InboxTriageFacet,
} from '@/lib/shared/inbox/items'
import { TicketIcon, BuildingOffice2Icon, RectangleStackIcon } from '@heroicons/react/24/outline'
import type { ConversationSort } from '@/lib/shared/conversation/views'
import type { TicketType } from '@/lib/shared/db-types'
import { NewConversationDialog } from '@/components/admin/conversation/new-conversation-dialog'
import { SearchSnippet } from '@/components/admin/conversation/search-snippet'
import {
  InboxScopeMenu,
  useSupportConversationsEnabled,
  type InboxNavItem,
} from '@/components/admin/conversation/inbox-nav-sidebar'
import { TicketStatusChip, TICKET_TYPE_CLASS } from '@/components/admin/inbox/ticket-chips'
import { NewButton } from '@/components/shared/new-button'
import { ActivationActionButton } from '@/components/admin/activation-action-button'
import { SearchInput } from '@/components/shared/search-input'
import {
  ConversationListToolbar,
  type CompanyFilter,
} from '@/components/admin/conversation/conversation-list-toolbar'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/shared/utils'
import { SPAM_REASON_LABELS, formatLabel, previewText } from './inbox-labels'
import { emptyStateMessage } from './inbox-empty-words'
import { useActivationAction } from '@/lib/client/hooks/use-activation-action'

/** Ignore scroll-by hovers; only warm a thread the pointer actually rests on. */
const PREFETCH_DELAY_MS = 120

const VISITOR = { id: 'admin.inbox.conversationListColumn.visitor', defaultMessage: 'Visitor' }
const NO_MESSAGES = {
  id: 'admin.inbox.conversationListColumn.noMessages',
  defaultMessage: 'No messages yet',
}

/** Stable string id for any inbox item (a conversation or ticket TypeID). */
function itemId(item: InboxItemDTO): string {
  return item.kind === 'conversation' ? item.conversation.id : item.ticket.id
}

const TICKET_TYPE_ICON: Record<TicketType, typeof TicketIcon> = {
  customer: TicketIcon,
  back_office: BuildingOffice2Icon,
  tracker: RectangleStackIcon,
}

/** A square type-glyph avatar for a ticket row (customer/back-office/tracker). */
function TicketTypeGlyph({ type }: { type: TicketType }) {
  const Icon = TICKET_TYPE_ICON[type]
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md',
        TICKET_TYPE_CLASS[type]
      )}
    >
      <Icon className="size-4" />
    </span>
  )
}

/** The assignee glyph for a ticket row: teammate avatar, team initial, or nothing. */
function TicketAssigneeGlyph({
  assignee,
}: {
  assignee: Extract<InboxItemDTO, { kind: 'ticket' }>['ticket']['assignee']
}) {
  const intl = useOptionalIntl()
  if (assignee.principalId) {
    return (
      <Avatar
        src={undefined}
        name={assignee.displayName ?? 'Agent'}
        className="size-5 shrink-0 text-xs"
      />
    )
  }
  if (assignee.teamId) {
    return (
      <span
        title={
          assignee.teamName ??
          intl.formatMessage({
            id: 'admin.inbox.conversationListColumn.team',
            defaultMessage: 'Team',
          })
        }
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
      >
        {nameInitial(assignee.teamName ?? 'T')}
      </span>
    )
  }
  return null
}

interface ConversationListColumnProps {
  nav: InboxNavItem
  onSelectNav: (item: InboxNavItem) => void
  scopeLabel: string
  /** Optional content rendered directly under the header (e.g. the company
   *  filter), above the search + refinement chips. */
  headerSlot?: ReactNode
  /** Whether to show the status/priority filter chips (hidden for the Mentions feed). */
  showRefinements: boolean
  /** Search input, mirrored from the nav sidebar (the list keeps a copy for the
   *  sub-lg layout where the nav pane is hidden). */
  searchInput: string
  onSearchInput: (value: string) => void
  /** The triage facet (open/waiting/closed/all) — UNIFIED-INBOX-SPEC.md §2.1. */
  facet: InboxTriageFacet
  onFacet: (value: InboxTriageFacet) => void
  priorityFilter: ConversationPriority | 'all'
  onPriorityFilter: (value: ConversationPriority | 'all') => void
  /** The tickets-branch registry-type dropdown (convergence Phase 4): the
   *  active `ticket_type` id (undefined = all), its setter, and the options
   *  for the active scope (undefined off the Tickets-section scopes — the
   *  dropdown renders only when options are provided). */
  ticketTypeFilter?: string
  onTicketTypeFilter?: (id: string | undefined) => void
  ticketTypeOptions?: Array<{ id: string; name: string; icon: string | null; color: string }>
  channelFilter?: Channel
  onChannelFilter?: (value: Channel | undefined) => void
  /** The company refinement; offered only when the workspace has companies. */
  companyFilter?: CompanyFilter
  sort: ConversationSort
  onSort: (value: ConversationSort) => void
  loading: boolean
  /** Unified inbox rows — a conversation (optionally wearing a linked-ticket
   *  chip) or a ticket (UNIFIED-INBOX-SPEC.md §2.1's one-row rule). */
  items: InboxItemDTO[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * The middle column of the inbox: scope header (desktop label / mobile scope
 * menu), search, the assignee/facet/priority refinements, and the unified
 * (conversation + ticket) item list itself. Purely presentational — all state
 * lives in the inbox route.
 */
export function ConversationListColumn({
  nav,
  onSelectNav,
  scopeLabel,
  headerSlot,
  showRefinements,
  searchInput,
  onSearchInput,
  facet,
  onFacet,
  priorityFilter,
  onPriorityFilter,
  ticketTypeFilter,
  onTicketTypeFilter,
  ticketTypeOptions,
  channelFilter,
  onChannelFilter,
  companyFilter,
  sort,
  onSort,
  loading,
  items,
  selectedId,
  onSelect,
}: ConversationListColumnProps) {
  const queryClient = useQueryClient()
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelPrefetch = useCallback(() => {
    if (prefetchTimer.current) {
      clearTimeout(prefetchTimer.current)
      prefetchTimer.current = null
    }
  }, [])
  useEffect(() => cancelPrefetch, [cancelPrefetch])
  const prefetchItem = useCallback(
    (id: string) => {
      cancelPrefetch()
      prefetchTimer.current = setTimeout(() => {
        const ref = inboxItemRefFromId(id)
        if (ref?.kind === 'conversation') {
          void queryClient.prefetchQuery(conversationInboxQueries.thread(ref.id))
        } else if (ref?.kind === 'ticket') {
          void queryClient.prefetchQuery(inboxQueries.ticketThread(ref.id))
          void queryClient.prefetchQuery(inboxQueries.ticketDetail(ref.id))
        }
      }, PREFETCH_DELAY_MS)
    },
    [cancelPrefetch, queryClient]
  )
  return (
    <div
      className={cn(
        'flex min-h-0 w-full shrink-0 flex-col border-e border-border/50 md:w-72 xl:w-[22.5rem]',
        // On mobile the list and thread are one column: hide the list while an
        // item is open (a back button returns to it).
        selectedId && 'hidden md:flex'
      )}
    >
      <ConversationListHeader
        nav={nav}
        onSelectNav={onSelectNav}
        scopeLabel={scopeLabel}
        headerSlot={headerSlot}
        showRefinements={showRefinements}
        searchInput={searchInput}
        onSearchInput={onSearchInput}
        facet={facet}
        onFacet={onFacet}
        priorityFilter={priorityFilter}
        onPriorityFilter={onPriorityFilter}
        ticketTypeFilter={ticketTypeFilter}
        onTicketTypeFilter={onTicketTypeFilter}
        ticketTypeOptions={ticketTypeOptions}
        channelFilter={channelFilter}
        onChannelFilter={onChannelFilter}
        companyFilter={companyFilter}
        sort={sort}
        onSort={onSort}
      />
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <ConversationListSkeleton />
        ) : items.length === 0 ? (
          <EmptyList
            nav={nav}
            facet={facet}
            scopeLabel={scopeLabel}
            searchInput={searchInput}
            priorityFilter={priorityFilter}
            channelFilter={channelFilter}
          />
        ) : (
          items.map((item) => {
            const id = itemId(item)
            return item.kind === 'conversation' ? (
              <ConversationRow
                key={id}
                id={id}
                item={item}
                selected={selectedId === id}
                onSelect={onSelect}
                onPrefetch={prefetchItem}
                onPrefetchCancel={cancelPrefetch}
              />
            ) : (
              <TicketRow
                key={id}
                id={id}
                item={item}
                selected={selectedId === id}
                onSelect={onSelect}
                onPrefetch={prefetchItem}
                onPrefetchCancel={cancelPrefetch}
              />
            )
          })
        )}
      </ScrollArea>
    </div>
  )
}

type ConversationListHeaderProps = Omit<
  ConversationListColumnProps,
  'loading' | 'items' | 'selectedId' | 'onSelect'
>

/**
 * The list column's header: scope label (desktop) or scope menu (mobile), the
 * compose button and dialog, search, and the sort and filter menus. Nothing
 * here depends on which item is open, so opening one re-renders only the
 * rows below it.
 */
const ConversationListHeader = memo(function ConversationListHeader({
  nav,
  onSelectNav,
  scopeLabel,
  headerSlot,
  showRefinements,
  searchInput,
  onSearchInput,
  facet,
  onFacet,
  priorityFilter,
  onPriorityFilter,
  ticketTypeFilter,
  onTicketTypeFilter,
  ticketTypeOptions,
  channelFilter,
  onChannelFilter,
  companyFilter,
  sort,
  onSort,
}: ConversationListHeaderProps) {
  const intl = useOptionalIntl()
  const [composeOpen, setComposeOpen] = useState(false)
  // A tickets-only workspace has no conversations to start.
  const canCompose = useSupportConversationsEnabled()
  const searching = searchInput.trim().length > 0
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
        {/* At lg+ the nav sidebar owns scope selection, so the header is a
            plain label. Below lg the sidebar is hidden, so offer a dropdown. */}
        <h2 className="hidden min-w-0 truncate text-sm font-semibold leading-tight lg:block">
          {scopeLabel}
        </h2>
        <div className="min-w-0 lg:hidden">
          <InboxScopeMenu nav={nav} onSelect={onSelectNav} />
        </div>
        {canCompose && (
          <NewButton noun="conversation" onClick={() => setComposeOpen(true)} className="shrink-0">
            {intl.formatMessage({
              id: 'admin.shell.newConversationDialog.newConversation',
              defaultMessage: 'New conversation',
            })}
          </NewButton>
        )}
      </div>
      {headerSlot}
      {canCompose && <NewConversationDialog open={composeOpen} onOpenChange={setComposeOpen} />}
      <div className="px-3 pt-2">
        <SearchInput
          value={searchInput}
          onChange={onSearchInput}
          placeholder={intl.formatMessage({
            id: 'admin.inbox.conversationListColumn.searchConversations',
            defaultMessage: 'Search conversations…',
          })}
          aria-label={intl.formatMessage({
            id: 'admin.inbox.conversationListColumn.searchTheInbox',
            defaultMessage: 'Search the inbox',
          })}
          data-search-input
        />
      </div>
      <ConversationListToolbar
        searching={searching}
        showRefinements={showRefinements}
        facet={facet}
        onFacet={onFacet}
        priorityFilter={priorityFilter}
        onPriorityFilter={onPriorityFilter}
        ticketTypeFilter={ticketTypeFilter}
        onTicketTypeFilter={onTicketTypeFilter}
        ticketTypeOptions={ticketTypeOptions}
        channelFilter={channelFilter}
        onChannelFilter={onChannelFilter}
        companyFilter={companyFilter}
        sort={sort}
        onSort={onSort}
      />
    </>
  )
})

/** One skeleton row — mirrors ConversationRow/TicketRow's fixed anatomy
 *  (avatar circle, name line, preview + time line) at the same `py-3` height
 *  and border so the list doesn't reflow when real rows replace it. */
/**
 * An empty list's message. The first-run call to action it may carry needs the
 * workspace's launch status, which is asked for only once a list is empty.
 */
function EmptyList({
  nav,
  facet,
  scopeLabel,
  searchInput,
  priorityFilter,
  channelFilter,
}: Pick<
  ConversationListColumnProps,
  'nav' | 'facet' | 'scopeLabel' | 'searchInput' | 'priorityFilter' | 'channelFilter'
>) {
  const intl = useOptionalIntl()
  const activationAction = useActivationAction('conversation_empty')

  const isMainConversationQueue =
    nav.kind === 'view' && (nav.view === 'mine' || nav.view === 'unassigned' || nav.view === 'all')
  const isFiltered =
    searchInput.trim().length > 0 ||
    priorityFilter !== 'all' ||
    !!channelFilter ||
    (facet !== 'all' && facet !== 'open')
  // A workspace that has never had a conversation gets the first-run state in
  // every main queue, whatever its launch plan says.
  const { data: history } = useQuery({
    queryKey: ['inbox', 'has-conversations'],
    queryFn: () => hasConversationsFn(),
    enabled: isMainConversationQueue && !isFiltered,
    staleTime: 60_000,
  })
  const firstRun = isMainConversationQueue && !isFiltered && history?.hasConversations === false
  const isAllClear =
    isMainConversationQueue && facet === 'open' && !isFiltered && !activationAction && !firstRun
  const emptyMsg = isFiltered
    ? intl.formatMessage({
        id: 'inbox.empty.filtered.title',
        defaultMessage: 'No conversations match these filters',
      })
    : (activationAction || firstRun) && isMainConversationQueue
      ? intl.formatMessage({
          id: 'inbox.empty.firstRun.title',
          defaultMessage: 'No conversations yet',
        })
      : isAllClear
        ? intl.formatMessage({
            id: 'inbox.empty.allClear.title',
            defaultMessage: 'Nothing to review',
          })
        : emptyStateMessage(intl, nav, facet, scopeLabel)
  // First-run CTA on the unfiltered main queues (not tickets/labels).
  const showMessengerCta = isMainConversationQueue && !isFiltered && !isAllClear
  return (
    <div
      className="px-4 py-10 text-center space-y-3"
      data-tour={isMainConversationQueue && !isFiltered ? 'support-empty' : undefined}
    >
      <p className="text-sm font-medium text-foreground">{emptyMsg}</p>
      {isFiltered && (
        <p className="mx-auto max-w-[16rem] text-xs text-muted-foreground">
          {intl.formatMessage({
            id: 'inbox.empty.filtered.description',
            defaultMessage: 'Try changing your search or filters.',
          })}
        </p>
      )}
      {isAllClear && (
        <p className="mx-auto max-w-[16rem] text-xs text-muted-foreground">
          {intl.formatMessage({
            id: 'inbox.empty.allClear.description',
            defaultMessage: 'No open conversations need your attention.',
          })}
        </p>
      )}
      {showMessengerCta && activationAction && (
        <ActivationActionButton
          action={activationAction}
          surface="conversation_empty"
          variant="outline"
          className="h-11 sm:h-9"
        />
      )}
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex w-full items-start border-b border-border/30">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 py-3 ps-3 pe-3">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-3.5 w-1/3" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-6 shrink-0" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Pending state for the inbox list column — ~8 rows shaped like the real
 *  conversation/ticket rows so the column doesn't visibly jank once `items`
 *  arrives and swaps in. */
function ConversationListSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}

/** Shared row chrome for either row kind. */
function RowShell({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'group relative flex w-full items-start border-b border-border/30 transition-colors',
        selected ? 'bg-muted/60' : 'hover:bg-muted/30'
      )}
    >
      {children}
    </div>
  )
}

/** The row's assignee column: a FIXED-width (w-24), left-aligned slot at a
 *  constant offset from the row's right edge, so assignees align down one
 *  unbroken vertical scan line whatever the snippet length. An unassigned
 *  thread renders an explicit "Unassigned" label in the same slot — the
 *  column is always present, never collapsing with row content. Kept tiny
 *  and muted so it scans as metadata, never as a second row identity. */
function assigneeColumn(c: ConversationDTO, intl: IntlShape) {
  if (!c.assignedAgent) {
    return (
      <span className="flex w-24 shrink-0 items-center text-xs text-muted-foreground/70">
        {intl.formatMessage({
          id: 'admin.inbox.conversationListColumn.unassigned',
          defaultMessage: 'Unassigned',
        })}
      </span>
    )
  }
  const fullName =
    c.assignedAgent.displayName ??
    intl.formatMessage({
      id: 'admin.inbox.conversationListColumn.teammate',
      defaultMessage: 'teammate',
    })
  // First name only: the column is a fixed 96px, so a full name would
  // ellipsis-truncate into noise; the full name stays one hover away on the
  // title.
  const firstName = fullName.split(' ')[0]
  return (
    <span
      title={intl.formatMessage(
        {
          id: 'admin.inbox.conversationListColumn.assignedTo',
          defaultMessage: 'Assigned to {name}',
        },
        { name: fullName }
      )}
      className="flex w-24 shrink-0 items-center gap-1 text-xs text-muted-foreground"
    >
      <Avatar
        src={c.assignedAgent.avatarUrl}
        name={fullName}
        className="size-5 shrink-0 text-[11px]"
      />
      <span className="truncate">{firstName}</span>
    </span>
  )
}

export const ConversationRow = memo(function ConversationRow({
  item,
  id,
  selected,
  onSelect,
  onPrefetch,
  onPrefetchCancel,
}: {
  item: Extract<InboxItemDTO, { kind: 'conversation' }>
  id: string
  selected: boolean
  onSelect: (id: string) => void
  onPrefetch?: (id: string) => void
  onPrefetchCancel?: () => void
}) {
  const intl = useOptionalIntl()
  const c = item.conversation
  return (
    <RowShell selected={selected}>
      {/* Rows keep a fixed anatomy (name / linked-ticket line / preview + time)
          so the list scans uniformly — the sometimes-present decorations
          (priority dot, SLA, channel, tags) live on the thread, not here. The
          ONE identity decoration is the assignee column pinned to the row's
          right edge at a fixed width (a glance must answer "who has this?"
          without opening the thread, and the fixed slot lets the eye scan
          assignees down one vertical line); unassigned threads render an
          explicit "Unassigned" label there, so the scan line never breaks. A
          result row swaps the preview for the matched excerpt and moves the
          time up beside the name, so the excerpt gets the full row width. */}
      <button
        type="button"
        onClick={() => onSelect(id)}
        onMouseEnter={onPrefetch ? () => onPrefetch(id) : undefined}
        onMouseLeave={onPrefetchCancel}
        onFocus={onPrefetch ? () => onPrefetch(id) : undefined}
        onBlur={onPrefetchCancel}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-3 ps-3 pe-3 text-start"
      >
        <Avatar
          src={c.visitor.avatarUrl}
          name={c.visitor.displayName ?? intl.formatMessage(VISITOR)}
          className="size-8 shrink-0 text-xs"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span dir="auto" className="truncate text-sm font-medium">
              {c.visitor.displayName ?? intl.formatMessage(VISITOR)}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {c.unreadCount > 0 && (
                <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
                  {c.unreadCount}
                </span>
              )}
              {item.searchSnippet && (
                <>
                  <TimeAgo date={c.lastMessageAt} short className="text-xs text-muted-foreground" />
                  {/* Rightmost on the row, so the column's left edge is the
                      same constant offset from the right edge on every row. */}
                  {assigneeColumn(c, intl)}
                </>
              )}
            </span>
          </div>
          {item.linkedTicket && (
            <div className="mt-0.5 flex items-center gap-1 text-xs">
              <TicketIcon className="size-3.5 shrink-0 text-foreground/70" />
              <span className="shrink-0 text-foreground/80">#{item.linkedTicket.number}</span>
              <span className="truncate text-muted-foreground">· {item.linkedTicket.title}</span>
            </div>
          )}
          {item.searchSnippet ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              <SearchSnippet segments={item.searchSnippet} />
            </p>
          ) : (
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <p dir="auto" className="min-w-0 truncate text-xs text-muted-foreground">
                {c.lastMessagePreview != null
                  ? previewText(intl, c.lastMessagePreview)
                  : (c.subject ?? intl.formatMessage(NO_MESSAGES))}
              </p>
              <span className="flex shrink-0 items-center gap-1.5">
                {/* The Spam view's one row decoration: which rule or classifier
                    filed the thread, so an agent scanning the list can spot a
                    false positive's source without opening it. */}
                {c.endReason === 'spam' && c.spamReason && (
                  <Badge size="sm" variant="outline">
                    {formatLabel(intl, SPAM_REASON_LABELS, c.spamReason)}
                  </Badge>
                )}
                {c.isTest && (
                  <Badge size="sm" variant="outline">
                    {intl.formatMessage({ id: 'inbox.row.test', defaultMessage: 'Test' })}
                  </Badge>
                )}
                <TimeAgo date={c.lastMessageAt} short className="text-xs text-muted-foreground" />
                {/* Rightmost on the row, so the column's left edge is the
                    same constant offset from the right edge on every row. */}
                {assigneeColumn(c, intl)}
              </span>
            </div>
          )}
        </div>
      </button>
    </RowShell>
  )
})

const TicketRow = memo(function TicketRow({
  item,
  id,
  selected,
  onSelect,
  onPrefetch,
  onPrefetchCancel,
}: {
  item: Extract<InboxItemDTO, { kind: 'ticket' }>
  id: string
  selected: boolean
  onSelect: (id: string) => void
  onPrefetch?: (id: string) => void
  onPrefetchCancel?: () => void
}) {
  const intl = useOptionalIntl()
  const t = item.ticket
  return (
    <RowShell selected={selected}>
      {/* Same fixed anatomy as ConversationRow (title / ticket line /
          preview + time) so mixed lists scan as one column. */}
      <button
        type="button"
        onClick={() => onSelect(id)}
        onMouseEnter={onPrefetch ? () => onPrefetch(id) : undefined}
        onMouseLeave={onPrefetchCancel}
        onFocus={onPrefetch ? () => onPrefetch(id) : undefined}
        onBlur={onPrefetchCancel}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-3 ps-3 pe-3 text-start"
      >
        <TicketTypeGlyph type={t.type} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span dir="auto" className="truncate text-sm font-medium">
              {t.title}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <TicketAssigneeGlyph assignee={t.assignee} />
              {item.unreadCount > 0 && (
                <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
                  {item.unreadCount}
                </span>
              )}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="font-mono text-xs text-foreground/80">#{t.number}</span>
            <TicketStatusChip status={t.status} />
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p dir="auto" className="min-w-0 truncate text-xs text-muted-foreground">
              {t.lastMessagePreview != null
                ? previewText(intl, t.lastMessagePreview)
                : intl.formatMessage(NO_MESSAGES)}
            </p>
            <TimeAgo date={t.updatedAt} short className="shrink-0 text-xs text-muted-foreground" />
          </div>
        </div>
      </button>
    </RowShell>
  )
})
