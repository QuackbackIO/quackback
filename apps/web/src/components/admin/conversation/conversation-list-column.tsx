import { memo, useState, type ReactNode } from 'react'
import { Link, useRouteContext } from '@tanstack/react-router'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import type { InboxItemDTO, InboxTriageFacet } from '@/lib/shared/inbox/items'
import { ChevronDownIcon, PencilSquareIcon, BarsArrowDownIcon } from '@heroicons/react/24/solid'
import { TicketIcon, BuildingOffice2Icon, RectangleStackIcon } from '@heroicons/react/24/outline'
import {
  CONVERSATION_SORTS,
  CONVERSATION_SORT_LABELS,
  type ConversationSort,
} from '@/lib/shared/conversation/views'
import type { TicketType } from '@/lib/shared/db-types'
import { NewConversationDialog } from '@/components/admin/conversation/new-conversation-dialog'
import { priorityMeta } from '@/lib/shared/conversation/priority-meta'
import { PriorityDot, PriorityMenuItems } from '@/components/admin/conversation/priority-control'
import { ChannelBadge } from '@/components/admin/conversation/channel-badge'
import { SlaChip } from '@/components/admin/conversation/sla-chip'
import {
  InboxScopeMenu,
  type InboxNavItem,
} from '@/components/admin/conversation/inbox-nav-sidebar'
import {
  TicketStatusChip,
  CATEGORY_CHIP,
  TICKET_TYPE_CLASS,
} from '@/components/admin/inbox/ticket-chips'
import { TagChip } from '@/components/shared/tag-chip'
import { Spinner } from '@/components/shared/spinner'
import { Avatar } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'
import { useReadinessAction } from '@/lib/client/hooks/use-readiness-action'
import { FormattedMessage, useIntl } from 'react-intl'

const TRIAGE_FACETS: readonly InboxTriageFacet[] = ['open', 'waiting', 'closed']

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** Stable string id for any inbox item (a conversation or ticket TypeID). */
function itemId(item: InboxItemDTO): string {
  return item.kind === 'conversation' ? item.conversation.id : item.ticket.id
}

/** The empty-list message for the active scope + facet. */
function emptyStateMessage(nav: InboxNavItem, facet: InboxTriageFacet, scopeLabel: string): string {
  if (nav.kind === 'tag') return `No conversations labelled ${scopeLabel}`
  if (nav.kind === 'segment') {
    const part = facet === 'all' ? '' : `${facet} `
    return `No ${part}conversations from ${scopeLabel}`
  }
  if (nav.kind === 'team') {
    const part = facet === 'all' ? '' : `${facet} `
    return `No ${part}conversations for ${scopeLabel}`
  }
  if (nav.kind === 'custom') return `No conversations match ${scopeLabel}`
  if (nav.kind === 'view') {
    const facetPart = facet === 'all' ? '' : `${facet} `
    switch (nav.view) {
      case 'mentions':
        return 'No conversations mention you yet'
      case 'mine':
        return `No ${facetPart}conversations assigned to you`
      case 'unassigned':
        return `No ${facetPart}unassigned conversations`
      case 'tickets_customer':
        return `No ${facetPart}customer tickets`
      case 'tickets_back_office':
        return `No ${facetPart}back office tickets`
      case 'tickets_tracker':
        return `No ${facetPart}trackers`
    }
    return `No ${facetPart}conversations`
  }
  // Unscoped empty inbox — first-run friendly, not filter-blame.
  if (facet === 'all') return 'No conversations yet'
  return `No ${facet} conversations`
}

/** A minimal category-tinted chip for the linked-customer-ticket summary on a
 *  conversation row. `LinkedTicketSummary` carries no per-status color (unlike
 *  the full `TicketStatusRef`), so this doesn't reuse `TicketStatusChip` — but
 *  it shares `CATEGORY_CHIP`'s tint so the two surfaces can't drift apart. */
function LinkedTicketChip({
  ticket,
}: {
  ticket: NonNullable<Extract<InboxItemDTO, { kind: 'conversation' }>['linkedTicket']>
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        CATEGORY_CHIP[ticket.statusCategory] ?? CATEGORY_CHIP.closed
      )}
    >
      #{ticket.number} · {ticket.statusName}
    </span>
  )
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
        title={assignee.teamName ?? 'Team'}
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
      >
        {(assignee.teamName ?? 'T').charAt(0).toUpperCase()}
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
  sort: ConversationSort
  onSort: (value: ConversationSort) => void
  loading: boolean
  /** Unified inbox rows — a conversation (optionally wearing a linked-ticket
   *  chip) or a ticket (UNIFIED-INBOX-SPEC.md §2.1's one-row rule). */
  items: InboxItemDTO[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Bulk-select set (a checkbox per row), TypeIDs of either kind. Kept
   *  visually quiet until at least one row is checked — see `selectionActive`. */
  selectedIds: Set<string>
  /** Toggle one row; `range` extends a contiguous range from the last-checked row
   *  (shift-click), across mixed conversation/ticket rows. The parent owns the
   *  ordered list, so it computes the range. */
  onToggleSelect: (id: string, opts?: { range?: boolean }) => void
  /** Select-all (in view) / clear-all toggle for the header checkbox. */
  onToggleSelectAll: () => void
  /** True once a selection exists — reveals the checkboxes + the select-all bar. */
  selectionActive: boolean
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
  sort,
  onSort,
  loading,
  items,
  selectedId,
  onSelect,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  selectionActive,
}: ConversationListColumnProps) {
  const intl = useIntl()
  const { userRole } = useRouteContext({ from: '__root__' })
  const readinessAction = useReadinessAction()
  const [composeOpen, setComposeOpen] = useState(false)
  const allSelected = items.length > 0 && items.every((it) => selectedIds.has(itemId(it)))
  const someSelected = items.some((it) => selectedIds.has(itemId(it)))
  return (
    <div
      className={cn(
        'flex min-h-0 w-full shrink-0 flex-col border-r border-border/50 md:w-80',
        // On mobile the list and thread are one column: hide the list while an
        // item is open (a back button returns to it).
        selectedId && 'hidden md:flex'
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-[0.85rem]">
        {/* At lg+ the nav sidebar owns scope selection, so the header is a
            plain label. Below lg the sidebar is hidden, so offer a dropdown. */}
        <h2 className="hidden min-w-0 truncate text-sm font-semibold leading-tight lg:block">
          {scopeLabel}
        </h2>
        <div className="min-w-0 lg:hidden">
          <InboxScopeMenu nav={nav} onSelect={onSelectNav} />
        </div>
        <button
          type="button"
          onClick={() => setComposeOpen(true)}
          title="New conversation"
          aria-label="New conversation"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PencilSquareIcon className="size-4" />
        </button>
      </div>
      {headerSlot}
      <NewConversationDialog open={composeOpen} onOpenChange={setComposeOpen} />
      {/* Search is owned by the nav pane at lg+; the list keeps a copy for the
          sub-lg layout where that pane is hidden. */}
      <div className="px-3 pt-2 lg:hidden">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => onSearchInput(e.target.value)}
          placeholder="Search…"
          aria-label="Search the inbox"
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none px-3 py-2">
        {/* Sort applies to every scope (including Mentions + custom views). */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Sort the inbox"
              className={cn(
                'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[13px] font-medium transition-colors',
                sort !== 'recent'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <BarsArrowDownIcon className="size-4" />
              {CONVERSATION_SORT_LABELS[sort]}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {CONVERSATION_SORTS.map((s) => (
              <DropdownMenuItem
                key={s}
                onClick={() => onSort(s)}
                className={cn(s === sort && 'text-primary')}
              >
                {CONVERSATION_SORT_LABELS[s]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {showRefinements && (
          <>
            {/* Triage facet — a removable filter chip (mirrors the feedback
                inbox), replacing the old per-status filter (UNIFIED-INBOX-SPEC.md
                §2.1: Open/Waiting/Closed/All). 'all' = no facet filter. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[13px] font-medium transition-colors',
                    facet !== 'all'
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  <span className="capitalize">{facet === 'all' ? 'Status' : facet}</span>
                  <ChevronDownIcon className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => onFacet('all')}>All</DropdownMenuItem>
                {TRIAGE_FACETS.map((f) => (
                  <DropdownMenuItem key={f} onClick={() => onFacet(f)} className="capitalize">
                    {f}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Filter by priority"
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[13px] font-medium transition-colors',
                    priorityFilter !== 'all'
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  <PriorityDot priority={priorityFilter === 'all' ? 'none' : priorityFilter} />
                  {priorityFilter === 'all' ? 'Priority' : priorityMeta(priorityFilter).label}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onPriorityFilter('all')}>
                  All priorities
                </DropdownMenuItem>
                <PriorityMenuItems
                  selected={priorityFilter === 'all' ? undefined : priorityFilter}
                  onSelect={onPriorityFilter}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
      {/* Progressive disclosure: the select-all + count bar only appears once a
          selection exists (the per-row checkboxes are the entry point). */}
      {selectionActive && (
        <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-1.5">
          <Checkbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={() => onToggleSelectAll()}
            aria-label="Select all items in view"
          />
          <span className="text-xs font-medium text-muted-foreground">
            {selectedIds.size} selected
          </span>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          (() => {
            const isMainConversationQueue =
              nav.kind === 'view' &&
              (nav.view === 'mine' || nav.view === 'unassigned' || nav.view === 'all')
            const isFiltered =
              searchInput.trim().length > 0 ||
              priorityFilter !== 'all' ||
              (facet !== 'all' && facet !== 'open')
            const isAllClear =
              isMainConversationQueue && facet === 'open' && !isFiltered && !readinessAction
            const emptyMsg = isFiltered
              ? intl.formatMessage({
                  id: 'inbox.empty.filtered.title',
                  defaultMessage: 'No conversations match these filters',
                })
              : isAllClear
                ? intl.formatMessage({
                    id: 'inbox.empty.allClear.title',
                    defaultMessage: 'You’re all caught up',
                  })
                : emptyStateMessage(nav, facet, scopeLabel)
            // First-run CTA on the unfiltered main queues (not tickets/labels).
            const showMessengerCta = isMainConversationQueue && !isFiltered && !isAllClear
            return (
              <div className="px-4 py-10 text-center space-y-3">
                <p className="text-sm font-medium text-foreground">{emptyMsg}</p>
                {isFiltered && (
                  <p className="mx-auto max-w-[16rem] text-xs text-muted-foreground">
                    <FormattedMessage
                      id="inbox.empty.filtered.description"
                      defaultMessage="Try changing your search or filters."
                    />
                  </p>
                )}
                {isAllClear && (
                  <p className="mx-auto max-w-[16rem] text-xs text-muted-foreground">
                    <FormattedMessage
                      id="inbox.empty.allClear.description"
                      defaultMessage="No open conversations need your attention."
                    />
                  </p>
                )}
                {showMessengerCta && (
                  <>
                    <p className="text-xs text-muted-foreground max-w-[16rem] mx-auto">
                      When customers message you, conversations show up here.
                    </p>
                    {/* Widget settings are admin-only; members get the message
                        without a button they can't use. */}
                    {userRole === 'admin' && readinessAction && (
                      <Button size="sm" variant="outline" className="h-11 sm:h-9" asChild>
                        <Link to={readinessAction.href}>{readinessAction.label}</Link>
                      </Button>
                    )}
                  </>
                )}
              </div>
            )
          })()
        ) : (
          items.map((item) => {
            const id = itemId(item)
            // `onSelect`/`onToggleSelect` are passed straight through (the
            // SAME stable reference every row gets, id-taking) rather than
            // wrapped in a per-row closure here — a fresh `() => onSelect(id)`
            // built on every list render would give each `memo`'d row a new
            // prop reference every time and defeat the memo (perf review).
            return item.kind === 'conversation' ? (
              <ConversationRow
                key={id}
                id={id}
                item={item}
                selected={selectedId === id}
                checked={selectedIds.has(id)}
                selectionActive={selectionActive}
                onSelect={onSelect}
                onToggleSelect={onToggleSelect}
              />
            ) : (
              <TicketRow
                key={id}
                id={id}
                item={item}
                selected={selectedId === id}
                checked={selectedIds.has(id)}
                selectionActive={selectionActive}
                onSelect={onSelect}
                onToggleSelect={onToggleSelect}
              />
            )
          })
        )}
      </ScrollArea>
    </div>
  )
}

/** Shared row chrome (checkbox + selection tint) for either row kind. */
function RowShell({
  checked,
  selected,
  selectionActive,
  ariaLabel,
  onToggleSelect,
  children,
}: {
  checked: boolean
  selected: boolean
  selectionActive: boolean
  ariaLabel: string
  onToggleSelect: (range: boolean) => void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'group relative flex w-full items-start border-b border-border/30 transition-colors',
        checked ? 'bg-primary/5' : selected ? 'bg-muted/60' : 'hover:bg-muted/30'
      )}
    >
      <div
        className={cn(
          'flex items-center self-stretch pl-3 pr-0.5 transition-opacity',
          selectionActive || checked
            ? 'opacity-100'
            : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
        )}
      >
        <Checkbox
          checked={checked}
          onClick={(e) => onToggleSelect(e.shiftKey)}
          aria-label={ariaLabel}
        />
      </div>
      {children}
    </div>
  )
}

const ConversationRow = memo(function ConversationRow({
  item,
  id,
  selected,
  checked,
  selectionActive,
  onSelect,
  onToggleSelect,
}: {
  item: Extract<InboxItemDTO, { kind: 'conversation' }>
  /** The row's own TypeID — `onSelect`/`onToggleSelect` are the SAME stable,
   *  id-taking callbacks every row in the list gets (see the `.map()` call
   *  site's comment); this row binds its own id when calling them. */
  id: string
  selected: boolean
  checked: boolean
  selectionActive: boolean
  onSelect: (id: string) => void
  onToggleSelect: (id: string, opts?: { range?: boolean }) => void
}) {
  const c = item.conversation
  return (
    <RowShell
      checked={checked}
      selected={selected}
      selectionActive={selectionActive}
      ariaLabel={`Select conversation from ${c.visitor.displayName ?? 'Visitor'}`}
      onToggleSelect={(range) => onToggleSelect(id, { range })}
    >
      <button
        type="button"
        onClick={() => onSelect(id)}
        className="flex min-w-0 flex-1 items-start gap-2.5 py-3 pl-1.5 pr-3 text-left"
      >
        <Avatar
          src={c.visitor.avatarUrl}
          name={c.visitor.displayName ?? 'Visitor'}
          className="size-8 shrink-0 text-xs"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <PriorityDot priority={c.priority} />
              <span className="truncate text-sm font-medium">
                {c.visitor.displayName ?? 'Visitor'}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {relativeTime(c.lastMessageAt)}
            </span>
          </div>
          {item.linkedTicket && (
            <div className="mt-1">
              <LinkedTicketChip ticket={item.linkedTicket} />
            </div>
          )}
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {c.lastMessagePreview ?? c.subject ?? 'No messages yet'}
          </p>
          {(c.channel !== 'messenger' || c.tags.length > 0 || c.sla) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <SlaChip sla={c.sla} status={c.status} />
              {c.channel !== 'messenger' && <ChannelBadge channel={c.channel} />}
              {c.tags.map((t) => (
                <TagChip
                  key={t.id}
                  name={t.name}
                  color={t.color}
                  className="px-1.5 py-0 text-[11px]"
                />
              ))}
            </div>
          )}
        </div>
        {c.unreadCount > 0 && (
          <span className="mt-1 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
            {c.unreadCount}
          </span>
        )}
      </button>
    </RowShell>
  )
})

const TicketRow = memo(function TicketRow({
  item,
  id,
  selected,
  checked,
  selectionActive,
  onSelect,
  onToggleSelect,
}: {
  item: Extract<InboxItemDTO, { kind: 'ticket' }>
  id: string
  selected: boolean
  checked: boolean
  selectionActive: boolean
  onSelect: (id: string) => void
  onToggleSelect: (id: string, opts?: { range?: boolean }) => void
}) {
  const t = item.ticket
  return (
    <RowShell
      checked={checked}
      selected={selected}
      selectionActive={selectionActive}
      ariaLabel={`Select ticket ${t.reference}`}
      onToggleSelect={(range) => onToggleSelect(id, { range })}
    >
      <button
        type="button"
        onClick={() => onSelect(id)}
        className="flex min-w-0 flex-1 items-start gap-2.5 py-3 pl-1.5 pr-3 text-left"
      >
        <TicketTypeGlyph type={t.type} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <PriorityDot priority={t.priority} />
              <span className="truncate text-sm font-medium">{t.title}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {relativeTime(t.updatedAt)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">#{t.number}</span>
            <TicketStatusChip status={t.status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t.lastMessagePreview ?? 'No messages yet'}
          </p>
        </div>
        <div className="mt-1 flex shrink-0 flex-col items-end gap-1">
          <TicketAssigneeGlyph assignee={t.assignee} />
          {item.unreadCount > 0 && (
            <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
              {item.unreadCount}
            </span>
          )}
        </div>
      </button>
    </RowShell>
  )
})
