import { createFileRoute, Navigate, redirect } from '@tanstack/react-router'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChatBubbleLeftRightIcon, ChevronDownIcon, TicketIcon } from '@heroicons/react/24/solid'
import { BuildingOffice2Icon } from '@heroicons/react/24/outline'
import { isValidTypeId } from '@quackback/ids'
import type {
  ConversationId,
  ConversationMessageId,
  CompanyId,
  TicketId,
  TicketStatusId,
} from '@quackback/ids'
import { coerceTicketTypeId } from '@/lib/shared/tickets'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import {
  isConversationSort,
  type ConversationSort,
  type ConversationViewDTO,
} from '@/lib/shared/conversation/views'
import { AgentConversationThread } from '@/components/conversation/agent-conversation-thread'
import {
  agentEventChangesInboxCounts,
  agentEventChangesInboxList,
  applyAgentThreadEvent,
  applyTicketThreadEvent,
  type AgentThreadCache,
  type TicketThreadCache,
} from '@/components/conversation/events-reducer'
import { conversationKeys } from '@/components/conversation/query-keys'
import { ConversationListColumn } from '@/components/admin/conversation/conversation-list-column'
import {
  SavedMessagesColumn,
  type SavedMessageTarget,
} from '@/components/admin/conversation/saved-messages-column'
import { BulkActionBar, type BulkMenuId } from '@/components/admin/conversation/bulk-action-bar'
import { InboxCommandBar } from '@/components/admin/conversation/inbox-command-bar'
import { ShortcutHelpPanel } from '@/components/admin/conversation/shortcut-help-panel'
import { DETAIL_PANEL_MEDIA_QUERY } from '@/components/admin/inbox/inbox-detail-panel'
import { useInboxKeyboard } from '@/components/admin/conversation/use-inbox-keyboard'
import {
  useBulkConversationUpdate,
  type BulkConversationAction,
  type BulkConversationSummary,
} from '@/lib/client/mutations/conversation-bulk'
import type { InboxActionId } from '@/lib/shared/conversation/inbox-actions'
import {
  assignConversationFn,
  setConversationPriorityFn,
  setConversationStatusFn,
  snoozeConversationFn,
} from '@/lib/server/functions/conversation'
import { assignConversationTeamFn } from '@/lib/server/functions/teams'
import { bulkUpdateTicketsFn, type BulkTicketActionInput } from '@/lib/server/functions/tickets'
import {
  useAssignTicket,
  useSetTicketPriority,
  useSetTicketStatus,
} from '@/lib/client/mutations/inbox'
import {
  InboxNavSidebar,
  isInboxView,
  isTicketInboxView as isTicketNavView,
  scopeLabelFor,
  useConversationTagsWithCounts,
  useInboxSegmentsWithCounts,
  useInboxTeams,
  useConversationViews,
} from '@/components/admin/conversation/inbox-nav-sidebar'
import { ConversationViewDialog } from '@/components/admin/conversation/conversation-view-dialog'
import { RequiredAttributesDialog } from '@/components/admin/conversation/required-attributes-dialog'
import { CreateTicketDialog } from '@/components/admin/inbox/create-ticket-dialog'
import { isMissingRequiredAttributesMessage } from '@/lib/shared/conversation/attribute-values'
import { resolveDefaultClosedStatusId } from '@/lib/shared/tickets'
import {
  inboxNavKey,
  navFromSearch,
  normalizeTriageFacet,
  facetToStatusFilter,
  buildInboxListParams,
  usesUnifiedInboxList,
  ticketTypeForView,
  PRIORITY_VALUES,
  type InboxNavItem,
  type InboxSearch,
} from '@/lib/client/conversation/inbox-scope'
import { conversationInboxQueries } from '@/lib/client/queries/conversation-inbox'
import { inboxQueries, inboxKeys, ticketQueries, ticketKeys } from '@/lib/client/queries/inbox'
import {
  inboxItemRefFromId,
  type InboxItemDTO,
  type InboxTriageFacet,
} from '@/lib/shared/inbox/items'
import { listCompaniesFn } from '@/lib/server/functions/companies'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import { useConversationStream } from '@/lib/client/hooks/use-conversation-stream'
import { useConversationTyping } from '@/lib/client/hooks/use-conversation-typing'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { useInboxListSource } from '@/lib/client/hooks/use-inbox-list-source'
import { useMediaQuery } from '@/lib/client/hooks/use-media-query'
import { useCopilotTabGate } from '@/lib/client/hooks/use-copilot-tab-gate'
import { EmptyState } from '@/components/shared/empty-state'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/shared/utils'
import {
  getFirstEnabledAdminProductPath,
  isProductEnabled,
  type FeatureFlags,
} from '@/lib/shared/types/settings'

/** Quinn-view outcome sub-filter (Fin's All / Pending / Escalated / Resolved). */
const QUINN_BUCKETS: {
  value: 'resolved' | 'escalated' | 'pending' | undefined
  label: string
}[] = [
  { value: undefined, label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
]

function QuinnBucketChips({
  value,
  counts,
  onChange,
}: {
  value?: 'resolved' | 'escalated' | 'pending'
  counts?: { resolved: number; escalated: number; pending: number }
  onChange: (value?: 'resolved' | 'escalated' | 'pending') => void
}) {
  const countFor = (v?: 'resolved' | 'escalated' | 'pending'): number | undefined => {
    if (!counts) return undefined
    return v ? counts[v] : counts.resolved + counts.escalated + counts.pending
  }
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2 pt-1">
      {QUINN_BUCKETS.map((b) => {
        const active = value === b.value
        const n = countFor(b.value)
        return (
          <button
            key={b.label}
            type="button"
            onClick={() => onChange(b.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium transition-colors',
              active
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {b.label}
            {n != null && <span className="tabular-nums opacity-70">{n}</span>}
          </button>
        )
      })}
    </div>
  )
}

export const Route = createFileRoute('/admin/inbox')({
  // `?i=<id>` deep-links the open item (a conversation OR ticket TypeID,
  // discriminated by prefix — UNIFIED-INBOX-SPEC.md §2.2). `?c=` is the legacy
  // alias, accepted forever (existing deep links in notification emails,
  // conversation.convert.ts, conversation.notify.ts) and normalized to `i` here.
  // `?view=`/`?tag=` deep-link the left-nav scope so it survives a refresh and is
  // shareable. Everything that defines the current view lives in the URL so a
  // refresh restores the exact open item + filters, and links are shareable.
  validateSearch: (search: Record<string, unknown>): InboxSearch => {
    const rawI = typeof search.i === 'string' ? search.i : undefined
    const rawC = typeof search.c === 'string' ? search.c : undefined
    const i =
      rawI && inboxItemRefFromId(rawI) ? rawI : rawC && inboxItemRefFromId(rawC) ? rawC : undefined
    return {
      i,
      // Only accept a well-formed conversation-message id — a stray `?m=` is harmless
      // (the thread just won't find it), but validating keeps it tidy.
      m:
        typeof search.m === 'string' && isValidTypeId(search.m, 'conversation_msg')
          ? search.m
          : undefined,
      // Allowlist tracks the nav view lists (incl. 'saved' + the Tickets-section
      // scopes) so deep-links can't silently drop a real view and fall back to
      // the conversation list.
      view: isInboxView(search.view) ? search.view : undefined,
      // Only accept a well-formed conversation-tag id — a malformed `?tag=` would reach a
      // uuid-backed query and 500 the conversation list.
      tag:
        typeof search.tag === 'string' && isValidTypeId(search.tag, 'conversation_tag')
          ? search.tag
          : undefined,
      // Only accept a well-formed segment id — a malformed `?segment=` would reach
      // a uuid-backed membership subquery and 500 the conversation list.
      segment:
        typeof search.segment === 'string' && isValidTypeId(search.segment, 'segment')
          ? search.segment
          : undefined,
      // Per-team inbox scope — validated to a real team id.
      team:
        typeof search.team === 'string' && isValidTypeId(search.team, 'team')
          ? search.team
          : undefined,
      // Custom saved view scope — validated to a real conversation-view id.
      viewId:
        typeof search.viewId === 'string' && isValidTypeId(search.viewId, 'conversation_view')
          ? search.viewId
          : undefined,
      // Inbox ordering; only a canonical sort is accepted (else the default).
      sort: isConversationSort(search.sort) ? search.sort : undefined,
      // The triage facet (open/waiting/closed/all), accepting the legacy
      // 'snoozed' value as 'waiting'.
      status: normalizeTriageFacet(search.status),
      priority: PRIORITY_VALUES.includes(search.priority as ConversationPriority | 'all')
        ? (search.priority as ConversationPriority | 'all')
        : undefined,
      // The tickets-branch registry-type dropdown — only a well-formed
      // ticket_type id is accepted (a junk value is dropped, never reaching
      // the uuid-backed ticket query).
      ttype: coerceTicketTypeId(typeof search.ttype === 'string' ? search.ttype : undefined),
      // Quinn-view sub-filter by involvement outcome; only the canonical buckets.
      ai:
        search.ai === 'resolved' || search.ai === 'escalated' || search.ai === 'pending'
          ? search.ai
          : undefined,
      q: typeof search.q === 'string' && search.q ? search.q : undefined,
      // Carries the shared `?post=` modal target (the admin layout mounts the
      // modal) so clicking an embedded post in a conversation opens it without leaving the
      // inbox. Validated to a real post id; a junk value is dropped.
      post:
        typeof search.post === 'string' && isValidTypeId(search.post, 'post')
          ? search.post
          : undefined,
      // Company refinement (deep-linked from the conversation CompanyCard). Only a
      // well-formed company id is accepted — a malformed `?company=` would reach a
      // uuid-backed subquery and 500 the conversation list.
      company:
        typeof search.company === 'string' && isValidTypeId(search.company, 'company')
          ? search.company
          : undefined,
    }
  },
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'support')) {
      throw redirect({ to: getFirstEnabledAdminProductPath(context.settings?.featureFlags) })
    }
  },
  // Re-run the prefetch when the scope / filters / open item change, so
  // a client-side navigation re-warms the cache too. ensureQueryData is a no-op
  // when the data is still fresh, so this doesn't double-fetch.
  loaderDeps: ({ search }) => ({
    view: search.view,
    tag: search.tag,
    segment: search.segment,
    team: search.team,
    viewId: search.viewId,
    sort: search.sort,
    status: search.status,
    priority: search.priority,
    ttype: search.ttype,
    ai: search.ai,
    q: search.q,
    i: search.i,
    company: search.company,
  }),
  loader: async ({ deps, context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
    const flags = context.settings?.featureFlags as FeatureFlags | undefined
    // The component redirects when neither flag is on — don't pay for a
    // prefetch. A tickets-only workspace (supportTickets on, supportInbox off)
    // still reaches this route (§2.3 decision log): the shell renders with
    // conversation affordances hidden.
    if (!flags?.supportInbox && !flags?.supportTickets) return {}
    const { queryClient } = context
    const nav = navFromSearch(deps)
    const facet: InboxTriageFacet = deps.status ?? 'open'
    const priority = deps.priority ?? 'all'
    const search = (deps.q ?? '').trim()
    const sort = deps.sort ?? 'recent'
    const isSaved = nav.kind === 'view' && nav.view === 'saved'
    // A custom view's list depends on its rule set (loaded client-side from the
    // views list), so — like Saved — it hydrates client-side, not here.
    const skipListPrefetch = isSaved || nav.kind === 'custom'
    const useUnified = usesUnifiedInboxList(nav)
    // A `?company=` deep link SSR-prefetches the FILTERED list under the same
    // factory key the component reads, so the filtered view hydrates too.
    const company = deps.company as CompanyId | undefined
    // Best-effort: a failed prefetch (e.g. a stale `?i=`) must never break the
    // page — each is caught independently and the component's useQuery still
    // fetches client-side, degrading to today's behavior.
    const warm = (p: Promise<unknown>) => p.catch(() => undefined)
    const ref = deps.i ? inboxItemRefFromId(deps.i) : null
    // Split (rather than a ternary passed straight into ensureQueryData) so
    // each branch's distinct TData/queryKey types are inferred independently —
    // a ternary union of the two queryOptions confuses ensureQueryData's
    // generic inference.
    let listPrefetch: Promise<unknown> | undefined
    if (skipListPrefetch) {
      listPrefetch = undefined
    } else if (useUnified) {
      listPrefetch = warm(
        queryClient.ensureQueryData(
          inboxQueries.itemList(
            buildInboxListParams(nav, facet, priority, search, company, sort, undefined, deps.ttype)
          )
        )
      )
    } else {
      listPrefetch = warm(
        queryClient.ensureQueryData(
          conversationInboxQueries.conversationList(
            nav,
            facetToStatusFilter(facet),
            priority,
            search,
            company,
            sort,
            undefined,
            deps.ai
          )
        )
      )
    }
    await Promise.all([
      listPrefetch,
      warm(queryClient.ensureQueryData(conversationInboxQueries.tagCounts())),
      warm(queryClient.ensureQueryData(conversationInboxQueries.segmentCounts())),
      warm(queryClient.ensureQueryData(conversationInboxQueries.views())),
      // Ticket thread prefetch arrives with M3 (ticket SSE); the loader only
      // warms the conversation thread cache for now.
      ref?.kind === 'conversation'
        ? warm(queryClient.ensureQueryData(conversationInboxQueries.thread(ref.id)))
        : undefined,
    ])
    return {}
  },
  component: InboxRoute,
})

/**
 * Gate the inbox behind `supportInbox` OR `supportTickets` (either enables the
 * shell — a tickets-only workspace still reaches it via the redirect route or
 * the single "Support" sidebar entry, §2.3's decision log). Wrapping keeps the
 * flag check above the inbox's hooks so they aren't conditionally called.
 */
function InboxRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox && !flags?.supportTickets) {
    return <Navigate to={getFirstEnabledAdminProductPath(flags)} />
  }
  return <InboxPage />
}

/** Split a mixed selection (conversation + ticket TypeIDs) into per-kind id
 *  arrays, dropping anything that doesn't resolve to a real ref. */
function splitByKind(ids: Iterable<string>): {
  conversationIds: ConversationId[]
  ticketIds: TicketId[]
} {
  const conversationIds: ConversationId[] = []
  const ticketIds: TicketId[] = []
  for (const id of ids) {
    const ref = inboxItemRefFromId(id)
    if (ref?.kind === 'conversation') conversationIds.push(ref.id)
    else if (ref?.kind === 'ticket') ticketIds.push(ref.id)
  }
  return { conversationIds, ticketIds }
}

/** The stable string id of any unified inbox row. */
function itemRefId(item: InboxItemDTO): string {
  return item.kind === 'conversation' ? item.conversation.id : item.ticket.id
}

/**
 * `ticket_updated` carries the full, fresh `TicketDTO` — rather than
 * invalidating the whole unified item-list (every scope/filter combo has its
 * own cache entry under `inboxKeys.items()`), patch the ONE row across all of
 * them directly: a standalone ticket row's own `ticket` field, or a plain
 * conversation row's `linkedTicket` chip when it points at this ticket. Rows
 * that don't reference this ticket, and any other cached list, come back
 * untouched (same array/object references) so unrelated list rows never
 * re-render off this event either (see conversation-list-column.tsx's row
 * memoization).
 */
function patchTicketInInboxLists(queryClient: QueryClient, ticket: TicketDTO): void {
  queryClient.setQueriesData<{ items: InboxItemDTO[]; cursor: string | null }>(
    { queryKey: inboxKeys.items() },
    (prev) => {
      if (!prev) return prev
      let changed = false
      const items = prev.items.map((item) => {
        if (item.kind === 'ticket' && item.ticket.id === ticket.id) {
          changed = true
          return { ...item, ticket }
        }
        if (item.kind === 'conversation' && item.linkedTicket?.id === ticket.id) {
          changed = true
          return {
            ...item,
            linkedTicket: {
              id: ticket.id,
              number: ticket.number,
              statusName: ticket.status.name,
              statusCategory: ticket.status.category,
            },
          }
        }
        return item
      })
      return changed ? { ...prev, items } : prev
    }
  )
}

function InboxPage() {
  const queryClient = useQueryClient()
  const navigate = Route.useNavigate()
  const {
    i: urlI,
    m: urlM,
    view: urlView,
    tag: urlTag,
    segment: urlSegment,
    team: urlTeam,
    viewId: urlViewId,
    sort: urlSort,
    status: urlStatus,
    priority: urlPriority,
    ttype: urlTicketType,
    q: urlQ,
    company: urlCompany,
    ai: urlAi,
    post: urlPost,
  } = Route.useSearch()

  // The URL is the single source of truth for the open item + filters, so a
  // refresh restores the exact view and any link is shareable. Every selection
  // merges into the search params (replace, so it doesn't spam history) and the
  // values below are derived straight back from the URL.
  const updateSearch = useCallback(
    (partial: Partial<InboxSearch>) => {
      void navigate({
        to: '/admin/inbox',
        search: (prev) => ({ ...prev, ...partial }),
        replace: true,
      })
    },
    [navigate]
  )

  // Left-nav scope: an assignee queue (Mine / Unassigned / All), the Mentions
  // feed, a Label, a Segment, a per-team inbox, a Tickets-section scope, or a
  // custom saved view. Scopes are mutually exclusive; precedence custom > team >
  // tag > segment > view. Status/priority chips refine WITHIN a built-in scope;
  // Mentions + custom views are self-contained so those chips are hidden.
  const nav = useMemo<InboxNavItem>(
    () =>
      navFromSearch({
        tag: urlTag,
        segment: urlSegment,
        team: urlTeam,
        viewId: urlViewId,
        view: urlView,
      }),
    [urlTag, urlSegment, urlTeam, urlViewId, urlView]
  )
  // Per-scope memory: each scope (view / tag / segment, keyed by inboxNavKey)
  // remembers the item last open in it, so returning to a scope resumes where
  // you left off instead of carrying a now-out-of-scope thread across or
  // dropping to an empty pane. Session-scoped (a refresh restores the current
  // scope + item from the URL). It only ever re-opens an item you yourself had
  // open here — never auto-opens an arbitrary unread one — so it can't silently
  // clear unread badges the way auto-opening the top would.
  const scopeMemory = useRef<Map<string, string>>(new Map())
  // Selecting any scope clears the others so exactly one stays in the URL, and
  // resumes that scope's last-open item (or clears to the empty state when
  // there's nothing remembered).
  const setNav = useCallback(
    (item: InboxNavItem) =>
      updateSearch({
        view: item.kind === 'view' ? item.view : undefined,
        tag: item.kind === 'tag' ? item.tagId : undefined,
        segment: item.kind === 'segment' ? item.segmentId : undefined,
        team: item.kind === 'team' ? item.teamId : undefined,
        viewId: item.kind === 'custom' ? item.viewId : undefined,
        i: scopeMemory.current.get(inboxNavKey(item)),
        m: undefined,
      }),
    [updateSearch]
  )

  const facet: InboxTriageFacet = urlStatus ?? 'open'
  const setFacet = useCallback(
    (f: InboxTriageFacet) => updateSearch({ status: f === 'open' ? undefined : f }),
    [updateSearch]
  )
  const priorityFilter: ConversationPriority | 'all' = urlPriority ?? 'all'
  const setPriorityFilter = useCallback(
    (p: ConversationPriority | 'all') => updateSearch({ priority: p === 'all' ? undefined : p }),
    [updateSearch]
  )
  // The tickets-branch registry-type dropdown (Phase 4). Selecting a type
  // clears the open item (it may fall outside the filtered list), mirroring
  // the company filter's `i: undefined` behavior.
  const setTicketTypeFilter = useCallback(
    (id: string | undefined) => updateSearch({ ttype: id, i: undefined, m: undefined }),
    [updateSearch]
  )
  const setSort = useCallback(
    (s: ConversationSort) => updateSearch({ sort: s === 'recent' ? undefined : s }),
    [updateSearch]
  )
  // The active selection, discriminated by kind (a conversation or a ticket).
  const selectedRef = useMemo(() => (urlI ? inboxItemRefFromId(urlI) : null), [urlI])
  const selectedId: string | null = selectedRef?.id ?? null
  // Selecting an item clears any stale jump target — `?m=` only ever pairs
  // with the conversation it was opened from (via selectSavedMessage).
  const setSelectedId = useCallback(
    (id: string | null) => updateSearch({ i: id ?? undefined, m: undefined }),
    [updateSearch]
  )
  // Open a conversation AND deep-link a specific message (the "Saved for later"
  // feed): the thread scrolls to it and flashes it on arrival. A ticket-parented
  // flag has no message-level deep link yet (§2.5's `deepLinkJump` capability is
  // off for tickets) — it just opens the ticket.
  const targetMessageId = (urlM as ConversationMessageId | undefined) ?? null
  const selectSavedMessage = useCallback(
    (target: SavedMessageTarget) =>
      'ticketId' in target
        ? updateSearch({ i: target.ticketId, m: undefined })
        : updateSearch({ i: target.conversationId, m: target.messageId }),
    [updateSearch]
  )

  // Open an embedded post (clicked in a conversation message) in the in-place
  // `?post=` modal the admin layout mounts — route-bound + search-only, so it
  // stays on /admin/inbox with `?i=` intact, and closing returns to the exact
  // conversation. Mirrors how the roadmap board opens a card; NOT `replace`, so
  // the browser back button closes the modal.
  const openPost = useCallback(
    (postId: string) => {
      void navigate({ to: '/admin/inbox', search: (prev) => ({ ...prev, post: postId }) })
    },
    [navigate]
  )

  const { data: navTags } = useConversationTagsWithCounts()
  const { data: navSegments } = useInboxSegmentsWithCounts()
  const { data: navTeams } = useInboxTeams()
  const { data: navViews } = useConversationViews()
  const scopeLabel = scopeLabelFor(nav, navTags, navSegments, navTeams, navViews)

  // The active custom view (if any): its saved rules become the list-query
  // params, and its own sort is the default until the user re-sorts. The
  // status/priority chips are hidden for a custom view (the view owns them),
  // as they are for the self-contained Mentions feed.
  const activeView: ConversationViewDTO | undefined =
    nav.kind === 'custom' ? navViews?.find((v) => v.id === nav.viewId) : undefined
  const showRefinements = nav.kind !== 'custom' && !(nav.kind === 'view' && nav.view === 'mentions')
  // Ordering: URL sort wins; else a custom view's saved sort; else the default.
  const sort: ConversationSort = urlSort ?? activeView?.sort ?? 'recent'

  // Custom-view dialog (create / edit), reachable from the nav "+" and per-view
  // menu. The route owns it so a save can select the new view.
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [editingView, setEditingView] = useState<ConversationViewDTO | null>(null)
  const openCreateView = useCallback(() => {
    setEditingView(null)
    setViewDialogOpen(true)
  }, [])
  const openEditView = useCallback((v: ConversationViewDTO) => {
    setEditingView(v)
    setViewDialogOpen(true)
  }, [])

  // Search is a live local input mirrored (debounced) into the URL `q`.
  const [searchInput, setSearchInput] = useState(urlQ ?? '')
  const search = useDebouncedValue(searchInput.trim(), 300)
  useEffect(() => {
    updateSearch({ q: search || undefined })
  }, [search, updateSearch])

  // The "Saved for later" view shows flagged MESSAGES, not conversations, so the
  // conversation-list query is idle there. The query options come from the shared
  // factory so the route loader's SSR prefetch (same key) hydrates this read.
  const isSaved = nav.kind === 'view' && nav.view === 'saved'

  // Company refinement: a picker in the list header + the deep-link from the
  // conversation CompanyCard. The picker only appears when companies exist.
  const { data: companies } = useQuery({
    queryKey: ['admin', 'companies'],
    queryFn: () => listCompaniesFn(),
    staleTime: 60_000,
  })
  // Drop a stale `?company=` (deleted / no longer visible) so the filter never
  // strands the list on an unselectable company — mirrors the tag/segment
  // scope-cleanup effect.
  useEffect(() => {
    if (urlCompany && companies && !companies.some((co) => co.id === urlCompany)) {
      updateSearch({ company: undefined })
    }
  }, [urlCompany, companies, updateSearch])

  // The unified endpoint (mine/unassigned/all, a team scope, a Tickets-section
  // scope, or a custom view carrying a ticket-only rule — §2.8) vs the legacy
  // conversation-only endpoint (mentions/quinn/saved, tag/segment, and a
  // custom view with no ticket rules — see inbox-scope.ts's module note). The
  // predicate + both param builders live in `useInboxListSource`; the loader
  // (server context, no hooks) makes its own `usesUnifiedInboxList` call above
  // against the same predicate for its SSR prefetch.
  const { items, isLoading: listLoading } = useInboxListSource({
    nav,
    facet,
    priorityFilter,
    search,
    companyId: urlCompany as CompanyId | undefined,
    sort,
    ticketTypeId: urlTicketType,
    activeViewFilters: activeView?.filters,
    aiBucket: nav.kind === 'view' && nav.view === 'quinn' ? urlAi : undefined,
    isSaved,
  })

  // Quinn-view sub-filter counts (only fetched while that view is open).
  const isQuinnView = nav.kind === 'view' && nav.view === 'quinn'
  const { data: assistantCounts } = useQuery({
    ...conversationInboxQueries.assistantCounts(),
    enabled: isQuinnView,
  })

  // The ticket status catalogue, needed to resolve "close" → the default
  // closed-category status for a ticket target (§3.4). Gated on the same flag
  // as the Tickets nav section — mirrors TicketDetail's existing assumption
  // that any agent who can reach a ticket item holds ticket.view.
  const { settings: routeSettings } = Route.useRouteContext()
  const showTickets =
    (routeSettings?.featureFlags as FeatureFlags | undefined)?.supportTickets ?? false
  const { data: ticketStatusList } = useQuery({
    ...ticketQueries.statuses(),
    enabled: showTickets,
  })

  // The tickets-branch registry-type dropdown (convergence Phase 4): options
  // come from the live registry, scoped to the active tickets view's category
  // (the "All tickets" scope offers every type). Only fetched on a tickets
  // scope — the dropdown renders nowhere else.
  const isTicketScope = nav.kind === 'view' && isTicketNavView(nav.view)
  const { data: registryTypes } = useQuery({
    ...ticketQueries.types(),
    enabled: showTickets && isTicketScope,
  })
  const ticketTypeOptions = useMemo(() => {
    if (!isTicketScope) return undefined
    const scopeCategory =
      nav.kind === 'view' && nav.view !== 'tickets_all' && isTicketNavView(nav.view)
        ? ticketTypeForView(nav.view)
        : undefined
    return (registryTypes ?? []).filter((t) => !scopeCategory || t.category === scopeCategory)
  }, [isTicketScope, nav, registryTypes])

  // Whether the detail panel's Copilot tab exists for this viewer right now —
  // the SAME gate InboxDetailPanel renders the tab from (useCopilotTabGate:
  // inboxAi flag + copilot.use) plus the ≥xl viewport that renders
  // the panel at all. Gates the Ask Copilot command-bar row and makes the `q`
  // shortcut a no-op when there is no panel to open.
  const copilotTabGate = useCopilotTabGate()
  const isDetailPanelViewport = useMediaQuery(DETAIL_PANEL_MEDIA_QUERY)
  const copilotAvailable = copilotTabGate && isDetailPanelViewport

  // Keep the active scope's memory in sync with what's open, so it's current the
  // moment you switch away. Only remember an item that's actually IN this
  // scope's list — a cross-scope deep-link (`?i=X` paired with an unrelated
  // `?tag=`) must not pollute the scope's memory and resurface out of scope.
  // (An item below the first page simply isn't remembered — recent ones
  // dominate.) Closing an item forgets it for the scope.
  useEffect(() => {
    const key = inboxNavKey(nav)
    if (selectedId && items.some((it) => itemRefId(it) === selectedId)) {
      scopeMemory.current.set(key, selectedId)
    } else if (!selectedId) {
      scopeMemory.current.delete(key)
    }
  }, [nav, selectedId, items])

  // If the active tag/segment/team/custom scope no longer exists (deleted here or
  // by another agent, or a stale deep-link to a removed id), fall back to the
  // default view instead of stranding the user on an empty, unlabelled scope.
  // Guarded on the option list having loaded so a valid scope isn't reset
  // mid-fetch.
  useEffect(() => {
    if (nav.kind === 'tag' && navTags && !navTags.some((t) => t.id === nav.tagId)) {
      updateSearch({ tag: undefined })
    } else if (
      nav.kind === 'segment' &&
      navSegments &&
      !navSegments.some((s) => s.id === nav.segmentId)
    ) {
      updateSearch({ segment: undefined })
    } else if (nav.kind === 'team' && navTeams && !navTeams.some((t) => t.id === nav.teamId)) {
      updateSearch({ team: undefined })
    } else if (nav.kind === 'custom' && navViews && !navViews.some((v) => v.id === nav.viewId)) {
      updateSearch({ viewId: undefined })
    }
  }, [nav, navTags, navSegments, navTeams, navViews, updateSearch])

  // Targeted cache refresh, split so each surface only pays for what actually
  // moved (a broad invalidate-everything on every SSE event/solo mutation was
  // measurably wasteful — see the perf review). `refreshInboxList` covers
  // both list surfaces (the legacy per-scope conversation list + the unified
  // item list); `refreshInboxCounts` is the separate nav-badge counts. A solo
  // mutation (assign/priority/snooze/close/reopen/create-ticket) always
  // touches both — the actor just made exactly that kind of change, and a
  // ticket mutation already seeds its own detail/list caches directly (see
  // the `assignTicketMutation`/etc comment below) — so `refreshInbox` below
  // stays their one call. The SSE handler is pickier: it reuses the reducer's
  // own predicates to invalidate only when an event could actually have
  // moved that surface, and patches `ticket_updated` directly instead of
  // invalidating at all (see `patchTicketInInboxLists`).
  const refreshInboxList = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: conversationKeys.agentConversations() })
    void queryClient.invalidateQueries({ queryKey: inboxKeys.items() })
  }, [queryClient])
  const refreshInboxCounts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: inboxKeys.counts() })
  }, [queryClient])
  const refreshInbox = useCallback(() => {
    refreshInboxList()
    refreshInboxCounts()
  }, [refreshInboxList, refreshInboxCounts])

  // Track whether the visitor of the selected conversation is currently typing.
  const {
    remoteTyping: visitorTyping,
    onRemoteTyping,
    clearRemoteTyping,
  } = useConversationTyping(() => {})
  // Collision detection: another agent typing in the same thread (self-echo is
  // filtered server-side, so any agent-typing here is a different agent).
  const {
    remoteTyping: otherAgentTyping,
    onRemoteTyping: onOtherAgentTyping,
    clearRemoteTyping: clearOtherAgentTyping,
  } = useConversationTyping(() => {})

  // The open conversation/ticket id, or null when the other kind (or nothing)
  // is selected.
  const activeConversationId = selectedRef?.kind === 'conversation' ? selectedRef.id : null
  const activeTicketId = selectedRef?.kind === 'ticket' ? selectedRef.id : null

  useConversationStream({
    enabled: true,
    buildUrl: async () => '/api/chat/stream?scope=inbox',
    onReconnect: refreshInbox,
    onEvent: (evt) => {
      // A ticket's live properties (status/assignee/priority/stage/type) name
      // their own cache keys precisely, so this patches them directly instead
      // of invalidating anything: the detail cache any open thread/panel
      // reads (`inboxQueries.ticketDetail`, keyed under `ticketKeys.detail`,
      // regardless of whether THIS ticket is the active item — it may be the
      // active conversation's linked ticket instead), and the matching row(s)
      // in every cached item-list page (`patchTicketInInboxLists`). No
      // membership/order invalidation follows for this event — the patch IS
      // the up-to-date row.
      if (evt.kind === 'ticket_updated') {
        queryClient.setQueryData(ticketKeys.detail(evt.ticket.id), evt.ticket)
        patchTicketInInboxLists(queryClient, evt.ticket)
      } else if (agentEventChangesInboxList(evt)) {
        // Every other membership/order/preview-changing event (a new message,
        // a conversation's status/assignee/tags, an agent-side read move) —
        // the reducer's own predicate decides, so this can't drift from what
        // the thread-cache reducers already treat as list-affecting.
        refreshInboxList()
      }
      // Nav-badge counts only move on an assignment/status/type change, never
      // on a message/reaction/flag/typing/read event — see the predicate's
      // own doc comment for why it's a separate check from the list one above.
      if (agentEventChangesInboxCounts(evt)) refreshInboxCounts()

      // Typing indicators are component state, not cache: a visitor message
      // clears the visitor dots; agent activity clears the collision notice
      // (self-echo is dropped server-side, so it's always another agent).
      // Ticket threads carry no typing capability (§2.5), so there's no
      // ticket-side equivalent to wire up here.
      if (evt.kind === 'message' && evt.conversationId === activeConversationId) {
        if (evt.message.senderType === 'visitor') clearRemoteTyping()
        if (evt.message.senderType === 'agent') clearOtherAgentTyping()
      } else if (evt.kind === 'typing' && evt.conversationId === activeConversationId) {
        if (evt.side === 'visitor') onRemoteTyping()
        else if (evt.side === 'agent') onOtherAgentTyping()
      }

      // Everything cache-shaped (message/read/updated/deleted/conversation)
      // routes through the pure reducer against the open thread's cache — one
      // branch per kind, since each has its own cache key + reducer.
      if (activeConversationId) {
        queryClient.setQueryData(
          conversationKeys.agentThread(activeConversationId),
          (prev: AgentThreadCache | undefined) =>
            applyAgentThreadEvent(prev, evt, activeConversationId)
        )
      } else if (activeTicketId) {
        queryClient.setQueryData(
          ticketKeys.thread(activeTicketId),
          (prev: TicketThreadCache | undefined) => applyTicketThreadEvent(prev, evt, activeTicketId)
        )
      }
    },
  })

  // ── Keyboard-first layer + bulk selection (support platform §4.6) ────────
  // Multi-select set (bulk actions) — TypeIDs of either kind. Cleared whenever
  // the scope/filters change so a stale id from a different list can never be
  // acted on, and after a fully successful bulk apply.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const hasSelection = selectedIds.size > 0
  const hasActiveConversation = !!selectedRef
  // True when the current target (the selection, or the solo active item)
  // includes a ticket — disables Snooze, which has no ticket-row equivalent.
  const hasTicketTarget = useMemo(() => {
    if (hasSelection) {
      for (const id of selectedIds) {
        if (inboxItemRefFromId(id)?.kind === 'ticket') return true
      }
      return false
    }
    return selectedRef?.kind === 'ticket'
  }, [hasSelection, selectedIds, selectedRef])
  // The solo active conversation's linked customer ticket (the one-row rule's
  // chip data rides on the list row). Gates the command bar's create_ticket —
  // a second ticket for the same conversation would be an orphan the list
  // never surfaces (the header icon/panel already hide their own affordance)
  // — and swaps in open_ticket, which navigates to the linked ticket instead.
  const activeLinkedTicket = useMemo(() => {
    if (hasSelection || selectedRef?.kind !== 'conversation') return null
    const row = items.find((it) => itemRefId(it) === selectedRef.id)
    return row?.kind === 'conversation' ? row.linkedTicket : null
  }, [hasSelection, selectedRef, items])
  // Which value menu the floating bar shows open — driven by the command bar /
  // keyboard so a single keypress can pop the right picker.
  const [bulkMenu, setBulkMenu] = useState<BulkMenuId | null>(null)
  // Close refusals from required-to-close enforcement (single or bulk): the
  // reasons shown in the blocking prompt, or null when nothing is blocked.
  const [closeBlocked, setCloseBlocked] = useState<string[] | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // Create-ticket flow (unified inbox §M5). The command bar's `create_ticket`
  // action pings the open conversation thread (`createTicketToken`, since
  // only that component holds the conversation data the dialog prefills
  // from) when a conversation is active, or opens the route-level standalone
  // dialog otherwise (nothing selected — the action is disabled for a ticket
  // target, see `isInboxActionEnabled`).
  const [createTicketToken, setCreateTicketToken] = useState(0)
  const [standaloneCreateTicketOpen, setStandaloneCreateTicketOpen] = useState(false)
  // Ask Copilot ping (`q` / command bar): the open thread's detail panel
  // switches to its Copilot tab and focuses the ask input on a bump — the
  // same token idiom as `createTicketToken`, since only that subtree owns the
  // tab state and the input node.
  const [openCopilotToken, setOpenCopilotToken] = useState(0)
  // A bump aimed at one item must never auto-open Copilot on the NEXT one, so
  // the token resets to 0 whenever the selection changes. Reset during render
  // (the adjust-state-while-rendering pattern), not in an effect: the detail
  // subtree remounts under `key={selectedRef.id}` in this same commit, and its
  // mount effects would otherwise observe the stale token before an effect
  // here could clear it. The panel treats 0 as "no pending bump".
  const copilotTokenItemRef = useRef(selectedId)
  if (copilotTokenItemRef.current !== selectedId) {
    copilotTokenItemRef.current = selectedId
    if (openCopilotToken !== 0) setOpenCopilotToken(0)
  }
  // The thread-side opener (the suggested-reply card's "Ask Copilot" link):
  // this route owns the token, so in-thread openers request a bump here
  // rather than merging their own counter with the forwarded one. Only handed
  // down while Copilot is actually openable (`copilotAvailable` — below xl
  // the detail panel is display:none, so a bump would be a dead click); the
  // card hides its Ask Copilot link when the callback is absent.
  const requestOpenCopilot = useCallback(() => setOpenCopilotToken((t) => t + 1), [])
  const requestOpenCopilotIfAvailable = copilotAvailable ? requestOpenCopilot : undefined
  // Anchor for shift-click range selection.
  const selectAnchor = useRef<string | null>(null)
  // The thread wrapper, so the reply action can focus the open composer.
  const threadContainerRef = useRef<HTMLDivElement>(null)
  const bulk = useBulkConversationUpdate()
  // Solo (no-selection) ticket mutations route through these shared hooks
  // rather than the raw server fns, so a change to the open ticket seeds
  // `ticketKeys.detail` immediately — the same cache-seeding `ticket-controls.tsx`
  // relies on — instead of waiting on `refreshInbox`'s broader invalidation.
  const assignTicketMutation = useAssignTicket()
  const priorityTicketMutation = useSetTicketPriority()
  const statusTicketMutation = useSetTicketStatus()

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setBulkMenu(null)
    selectAnchor.current = null
  }, [])

  // Reset the selection when the visible list changes (scope / facet / priority
  // / company / search) — the checked ids belong to the previous list. The
  // first-mount clear is harmless (the selection starts empty).
  const selectionScopeKey = `${inboxNavKey(nav)}|${facet}|${priorityFilter}|${urlCompany ?? ''}|${search}`
  useEffect(() => {
    clearSelection()
  }, [selectionScopeKey, clearSelection])

  const toggleSelect = useCallback(
    (id: string, opts?: { range?: boolean }) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        const ids = items.map((it) => itemRefId(it))
        const a = selectAnchor.current ? ids.indexOf(selectAnchor.current) : -1
        const b = ids.indexOf(id)
        if (opts?.range && a >= 0 && b >= 0) {
          // Shift-click adds the contiguous range from the anchor to here.
          const [lo, hi] = a < b ? [a, b] : [b, a]
          for (let i = lo; i <= hi; i++) next.add(ids[i])
        } else if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })
      selectAnchor.current = id
    },
    [items]
  )

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const ids = items.map((it) => itemRefId(it))
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id))
      return allSelected ? new Set() : new Set(ids)
    })
  }, [items])

  // Toast the bulk summary: a clean line on full success, a partial-failure count
  // otherwise. Verb is the past-tense action word ("Closed", "Snoozed", …).
  const summarize = useCallback((verb: string, ok: number, fail: number) => {
    if (fail === 0) {
      toast.success(`${verb} ${ok} ${ok === 1 ? 'item' : 'items'}`)
    } else {
      toast.warning(`${ok} updated, ${fail} failed`)
    }
  }, [])

  /** Apply a conversation-only bulk action, filtering the selection down to
   *  conversation ids (silently dropping any ticket ids — used by snooze/reopen,
   *  which have no ticket-row equivalent). No-ops when nothing conversation-kind
   *  is selected. */
  const runConversationOnlyBulk = useCallback(
    async (action: BulkConversationAction, verb: string) => {
      const { conversationIds } = splitByKind(selectedIds)
      if (conversationIds.length === 0) return
      try {
        const res = await bulk.mutateAsync({ conversationIds, action })
        summarize(verb, res.succeeded.length, res.failed.length)
        if (res.failed.length === 0) clearSelection()
        else setBulkMenu(null)
      } catch {
        toast.error('Bulk action failed')
      }
    },
    [selectedIds, bulk, summarize, clearSelection]
  )

  /** Apply a bulk action to a mixed selection: conversation ids via the shared
   *  bulk mutation, ticket ids via the bulk ticket server fn, summarized
   *  together. Returns each kind's own result too — `applyClose` reuses this
   *  for its required-attributes blocking prompt, which only ever reads
   *  conversation failures. */
  const runMixedBulk = useCallback(
    async (
      verb: string,
      conversationAction: BulkConversationAction | null,
      ticketAction: BulkTicketActionInput | null
    ): Promise<{
      conversationResult: BulkConversationSummary
      ticketResult: BulkConversationSummary
    }> => {
      const { conversationIds, ticketIds } = splitByKind(selectedIds)
      const [conversationResult, ticketResult] = await Promise.all([
        conversationIds.length && conversationAction
          ? bulk.mutateAsync({ conversationIds, action: conversationAction })
          : Promise.resolve<BulkConversationSummary>({ succeeded: [], failed: [] }),
        ticketIds.length && ticketAction
          ? bulkUpdateTicketsFn({ data: { ticketIds, action: ticketAction } })
          : Promise.resolve<BulkConversationSummary>({ succeeded: [], failed: [] }),
      ])
      const succeeded = [...conversationResult.succeeded, ...ticketResult.succeeded]
      const failed = [...conversationResult.failed, ...ticketResult.failed]
      summarize(verb, succeeded.length, failed.length)
      refreshInbox()
      if (failed.length === 0) clearSelection()
      else setBulkMenu(null)
      return { conversationResult, ticketResult }
    },
    [selectedIds, bulk, summarize, refreshInbox, clearSelection]
  )

  // Apply a single-item action for the solo (no-selection) case: run its own
  // server fn, refresh the inbox, and toast the outcome. Always dismisses any
  // open value menu so every control behaves the same.
  const runSolo = useCallback(
    async (fn: () => Promise<unknown>, msg: { success: string; error: string }) => {
      setBulkMenu(null)
      try {
        await fn()
        refreshInbox()
        toast.success(msg.success)
      } catch {
        toast.error(msg.error)
      }
    },
    [refreshInbox]
  )

  /** One "assign / assignTeam / priority"-shaped verb: a selection routes
   *  through the mixed-kind bulk mutation; a solo target dispatches straight
   *  to its own kind — the ticket case through its shared mutation hook
   *  (`mutateAsync`, see the comment by `assignTicketMutation` above), the
   *  conversation case through its own server fn. A missing ticket verb is
   *  just a missing table entry at the call site, not a new branch here.
   *  Snooze/reopen don't fit this shape (no ticket verb at all) and keep their
   *  own `runConversationOnlyBulk`-based implementations below. */
  const applyVerb = useCallback(
    async <TArgs,>(
      args: TArgs,
      opts: {
        verb: string
        bulkAction: (args: TArgs) => BulkConversationAction
        ticketBulkAction: (args: TArgs) => BulkTicketActionInput
        soloTicket: (ticketId: TicketId, args: TArgs) => Promise<unknown>
        soloConversation: (conversationId: ConversationId, args: TArgs) => Promise<unknown>
        messages: {
          ticket: { success: string; error: string }
          conversation: { success: string; error: string }
        }
      }
    ) => {
      if (hasSelection) {
        await runMixedBulk(opts.verb, opts.bulkAction(args), opts.ticketBulkAction(args))
        return
      }
      if (!selectedRef) return
      if (selectedRef.kind === 'ticket') {
        return runSolo(() => opts.soloTicket(selectedRef.id, args), opts.messages.ticket)
      }
      return runSolo(() => opts.soloConversation(selectedRef.id, args), opts.messages.conversation)
    },
    [hasSelection, selectedRef, runMixedBulk, runSolo]
  )

  const applyAssign = useCallback(
    (assignTo: string | null) =>
      applyVerb(assignTo, {
        verb: 'Assigned',
        bulkAction: (a) => ({ type: 'assign', assignTo: a }),
        ticketBulkAction: (a) => ({ type: 'assign', assignTo: a }),
        soloTicket: (id, a) =>
          assignTicketMutation.mutateAsync({ ticketId: id, assigneePrincipalId: a }),
        soloConversation: (id, a) =>
          assignConversationFn({ data: { conversationId: id, assignTo: a } }),
        messages: {
          ticket: { success: 'Ticket assigned', error: 'Failed to assign ticket' },
          conversation: {
            success: 'Conversation assigned',
            error: 'Failed to assign conversation',
          },
        },
      }),
    [applyVerb, assignTicketMutation]
  )

  const applyAssignTeam = useCallback(
    (teamId: string) =>
      applyVerb(teamId, {
        verb: 'Assigned',
        bulkAction: (t) => ({ type: 'assign_team', teamId: t }),
        ticketBulkAction: (t) => ({ type: 'assign_team', teamId: t }),
        soloTicket: (id, t) =>
          assignTicketMutation.mutateAsync({ ticketId: id, assigneeTeamId: t }),
        soloConversation: (id, t) =>
          assignConversationTeamFn({ data: { conversationId: id, teamId: t } }),
        messages: {
          ticket: { success: 'Assigned to team', error: 'Failed to assign team' },
          conversation: { success: 'Assigned to team', error: 'Failed to assign team' },
        },
      }),
    [applyVerb, assignTicketMutation]
  )

  const applyPriority = useCallback(
    (priority: ConversationPriority) =>
      applyVerb(priority, {
        verb: 'Updated',
        bulkAction: (p) => ({ type: 'priority', priority: p }),
        ticketBulkAction: (p) => ({ type: 'priority', priority: p }),
        soloTicket: (id, p) => priorityTicketMutation.mutateAsync({ ticketId: id, priority: p }),
        soloConversation: (id, p) =>
          setConversationPriorityFn({ data: { conversationId: id, priority: p } }),
        messages: {
          ticket: { success: 'Priority updated', error: 'Failed to set priority' },
          conversation: { success: 'Priority updated', error: 'Failed to set priority' },
        },
      }),
    [applyVerb, priorityTicketMutation]
  )

  // Snooze has no ticket-row equivalent (§2.5: the status axis stands in for
  // it) — the bulk bar disables its trigger whenever the target includes a
  // ticket (`hasTicketTarget`), so this only ever runs against conversation ids.
  const applySnooze = useCallback(
    async (until: string | null) => {
      if (hasSelection) {
        return runConversationOnlyBulk({ type: 'snooze', until }, 'Snoozed')
      }
      if (!selectedRef || selectedRef.kind === 'ticket') return
      return runSolo(
        () => snoozeConversationFn({ data: { conversationId: selectedRef.id, until } }),
        { success: 'Conversation snoozed', error: 'Failed to snooze conversation' }
      )
    },
    [hasSelection, selectedRef, runConversationOnlyBulk, runSolo]
  )

  const applyClose = useCallback(async () => {
    const closedStatusId = resolveDefaultClosedStatusId(ticketStatusList)
    if (hasSelection) {
      const { ticketIds } = splitByKind(selectedIds)
      if (ticketIds.length > 0 && !closedStatusId) {
        toast.error('No closed ticket status is configured')
      }
      try {
        // `runMixedBulk` already does the succeeded/failed merge, the summary
        // toast, `refreshInbox`, and the clear-selection/keep-menu-open split;
        // only the required-attributes blocking prompt below is close-specific,
        // so it reads `conversationResult` straight off the shared helper's
        // return value instead of re-running the whole dispatch by hand. No
        // ticket verb at all (rather than the missing-status toast above)
        // when there's no closed status configured — mirrors the pre-shared
        // behavior of silently skipping ticket ids in that case.
        const { conversationResult } = await runMixedBulk(
          'Closed',
          { type: 'close' },
          closedStatusId ? { type: 'set_status', statusId: closedStatusId } : null
        )
        // Required-to-close refusals get the blocking prompt (one line per
        // distinct reason); other failures keep the generic summary toast.
        const blocked = [
          ...new Set(
            conversationResult.failed
              .map((f) => f.reason)
              .filter((reason) => isMissingRequiredAttributesMessage(reason))
          ),
        ]
        if (blocked.length > 0) {
          const count = conversationResult.failed.filter((f) =>
            isMissingRequiredAttributesMessage(f.reason)
          ).length
          setCloseBlocked([
            `${count} ${count === 1 ? 'conversation is' : 'conversations are'} missing required attributes.`,
            ...blocked,
          ])
        }
      } catch {
        toast.error('Bulk action failed')
      }
      return
    }
    if (!selectedRef) return
    if (selectedRef.kind === 'ticket') {
      if (!closedStatusId) {
        toast.error('No closed ticket status is configured')
        return
      }
      return runSolo(
        () =>
          statusTicketMutation.mutateAsync({
            ticketId: selectedRef.id,
            statusId: closedStatusId as TicketStatusId,
          }),
        { success: 'Ticket resolved', error: 'Failed to resolve ticket' }
      )
    }
    setBulkMenu(null)
    try {
      await setConversationStatusFn({ data: { conversationId: selectedRef.id, status: 'closed' } })
      refreshInbox()
      toast.success('Conversation closed')
    } catch (error) {
      const message = error instanceof Error ? error.message : null
      if (message && isMissingRequiredAttributesMessage(message)) setCloseBlocked([message])
      else toast.error('Failed to close conversation')
    }
  }, [
    hasSelection,
    selectedIds,
    selectedRef,
    ticketStatusList,
    runMixedBulk,
    statusTicketMutation,
    runSolo,
    refreshInbox,
  ])

  // Reopen stays conversation-only for M2 — the ticket capability matrix (§2.5)
  // has no "reopen" verb of its own (a resolved ticket is reopened via its
  // status control), so a ticket-only target is a no-op here.
  const applyReopen = useCallback(async () => {
    if (hasSelection) {
      return runConversationOnlyBulk({ type: 'reopen' }, 'Reopened')
    }
    if (!selectedRef || selectedRef.kind === 'ticket') return
    return runSolo(
      () => setConversationStatusFn({ data: { conversationId: selectedRef.id, status: 'open' } }),
      { success: 'Conversation reopened', error: 'Failed to reopen conversation' }
    )
  }, [hasSelection, selectedRef, runConversationOnlyBulk, runSolo])

  // Focus the open thread's composer (the single contenteditable inside it). The
  // `.ProseMirror` selector couples to the editor's internals; the proper fix is a
  // composer imperative handle (next wave). Works for either thread kind since
  // both use the same rich-text editor.
  const focusComposer = useCallback(() => {
    threadContainerRef.current
      ?.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]')
      ?.focus()
  }, [])

  // j / k: move the open item to the next / previous row in the list.
  const moveSelection = useCallback(
    (delta: number) => {
      if (items.length === 0) return
      const ids = items.map((it) => itemRefId(it))
      const idx = selectedId ? ids.indexOf(selectedId) : -1
      const nextIdx =
        idx < 0
          ? delta > 0
            ? 0
            : ids.length - 1
          : Math.min(Math.max(idx + delta, 0), ids.length - 1)
      setSelectedId(ids[nextIdx])
    },
    [items, selectedId, setSelectedId]
  )

  // The single action router shared by the command bar and the keyboard hook.
  // Both-scope value actions (assign/team/priority/snooze) pop the matching menu
  // in the floating bar (targeting the selection, or the single open thread);
  // close/reopen apply immediately. Snooze is additionally gated on
  // `!hasTicketTarget` (§2.5). See the report for the value-action UX note.
  const onInboxAction = useCallback(
    (id: InboxActionId) => {
      const needsTarget = hasSelection || hasActiveConversation
      switch (id) {
        case 'reply':
          focusComposer()
          break
        case 'next':
          moveSelection(1)
          break
        case 'prev':
          moveSelection(-1)
          break
        case 'toggle_select':
          if (selectedId) toggleSelect(selectedId)
          break
        case 'assign':
          if (needsTarget) setBulkMenu('assign')
          break
        case 'assign_team':
          if (needsTarget) setBulkMenu('assign_team')
          break
        case 'priority':
          if (needsTarget) setBulkMenu('priority')
          break
        case 'snooze':
          if (needsTarget && !hasTicketTarget) setBulkMenu('snooze')
          break
        case 'close':
          if (needsTarget) void applyClose()
          break
        case 'reopen':
          if (needsTarget) void applyReopen()
          break
        case 'create_ticket':
          // Never mint an orphan ticket on a conversation that already links
          // one (the palette row is greyed out via hasLinkedTicket; this also
          // covers the `c` key, which skips the palette's disabled gate).
          if (activeLinkedTicket) break
          if (selectedRef?.kind === 'conversation') setCreateTicketToken((t) => t + 1)
          else if (!hasTicketTarget) setStandaloneCreateTicketOpen(true)
          break
        case 'open_ticket':
          // The linked-ticket alternative to create_ticket: the ticket has no
          // row of its own (one-row rule), but selecting its id opens its
          // thread the same way a cross-scope deep-link would.
          if (activeLinkedTicket) setSelectedId(activeLinkedTicket.id)
          break
        case 'copilot':
          // No-op unless the Copilot tab actually exists for this viewer and
          // an item is open — never a broken state (mirrors the palette gate
          // in isInboxActionEnabled).
          if (copilotAvailable && selectedRef) setOpenCopilotToken((t) => t + 1)
          break
      }
    },
    [
      hasSelection,
      hasActiveConversation,
      hasTicketTarget,
      activeLinkedTicket,
      selectedRef,
      focusComposer,
      moveSelection,
      selectedId,
      toggleSelect,
      setSelectedId,
      applyClose,
      applyReopen,
      copilotAvailable,
    ]
  )

  // Bind global shortcuts only when the inbox itself is focused — never behind a
  // modal (command bar, help, the view dialog, or the `?post=` overlay), so their
  // own key handling wins.
  useInboxKeyboard({
    enabled: !commandOpen && !helpOpen && !viewDialogOpen && !urlPost,
    onAction: onInboxAction,
    onOpenCommandBar: () => setCommandOpen(true),
    onOpenHelp: () => setHelpOpen(true),
  })

  // The floating bar shows for a real multi-selection, or when a value menu was
  // popped for the single open item.
  const bulkBarVisible = hasSelection || (bulkMenu !== null && hasActiveConversation)

  return (
    <div className="flex h-full">
      <InboxNavSidebar
        nav={nav}
        onSelect={setNav}
        search={searchInput}
        onSearch={setSearchInput}
        onCreateView={openCreateView}
        onEditView={openEditView}
      />
      <ConversationViewDialog
        open={viewDialogOpen}
        onOpenChange={setViewDialogOpen}
        editing={editingView}
        onSaved={(viewId) => setNav({ kind: 'custom', viewId })}
      />
      <RequiredAttributesDialog messages={closeBlocked} onClose={() => setCloseBlocked(null)} />
      {/* Standalone create-ticket (command bar with nothing selected) — the
          "from a conversation" flow is mounted inside `AgentConversationThread`
          instead, where the conversation data it prefills from already lives. */}
      <CreateTicketDialog
        open={standaloneCreateTicketOpen}
        onOpenChange={setStandaloneCreateTicketOpen}
        onCreated={(id) => setSelectedId(id)}
        onChanged={refreshInbox}
      />
      {isSaved ? (
        <SavedMessagesColumn selectedId={selectedId} onSelect={selectSavedMessage} />
      ) : (
        <ConversationListColumn
          nav={nav}
          onSelectNav={setNav}
          scopeLabel={scopeLabel}
          showRefinements={showRefinements}
          // Quinn view: the outcome sub-filter chips (Fin's Resolved/Escalated/
          // Pending). Otherwise the company picker, shown only when the workspace
          // has companies to filter by.
          headerSlot={
            isQuinnView ? (
              <QuinnBucketChips
                value={urlAi}
                counts={assistantCounts}
                onChange={(ai) => updateSearch({ ai, i: undefined, m: undefined })}
              />
            ) : companies && companies.length > 0 ? (
              <CompanyInboxFilter
                companies={companies}
                value={urlCompany}
                onChange={(id) => updateSearch({ company: id, i: undefined, m: undefined })}
              />
            ) : undefined
          }
          searchInput={searchInput}
          onSearchInput={setSearchInput}
          facet={facet}
          onFacet={setFacet}
          priorityFilter={priorityFilter}
          onPriorityFilter={setPriorityFilter}
          ticketTypeFilter={urlTicketType}
          onTicketTypeFilter={setTicketTypeFilter}
          ticketTypeOptions={ticketTypeOptions}
          sort={sort}
          onSort={setSort}
          loading={listLoading}
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          selectionActive={hasSelection}
        />
      )}

      {/* Thread / detail pane. Both kinds render the unified thread, which
          mounts the one unified `InboxDetailPanel` internally (§2.7, M5). */}
      <div
        ref={threadContainerRef}
        className={cn('min-w-0 flex-1', !selectedRef && 'hidden md:block')}
      >
        {selectedRef?.kind === 'ticket' ? (
          <AgentConversationThread
            key={selectedRef.id}
            item={selectedRef}
            targetMessageId={null}
            onChanged={refreshInbox}
            onBack={() => setSelectedId(null)}
            onSelectItem={setSelectedId}
            onOpenPost={openPost}
            isVisitorTyping={false}
            isOtherAgentTyping={false}
            openCopilotToken={openCopilotToken}
            requestOpenCopilot={requestOpenCopilotIfAvailable}
          />
        ) : selectedRef?.kind === 'conversation' ? (
          <AgentConversationThread
            key={selectedRef.id}
            item={selectedRef}
            targetMessageId={targetMessageId}
            onChanged={refreshInbox}
            onBack={() => setSelectedId(null)}
            onSelectItem={setSelectedId}
            onOpenPost={openPost}
            isVisitorTyping={visitorTyping}
            isOtherAgentTyping={otherAgentTyping}
            createTicketToken={createTicketToken}
            openCopilotToken={openCopilotToken}
            requestOpenCopilot={requestOpenCopilotIfAvailable}
          />
        ) : (
          <div className="hidden h-full items-center justify-center md:flex">
            <EmptyState
              icon={isTicketScope ? TicketIcon : ChatBubbleLeftRightIcon}
              title={isTicketScope ? 'Select a ticket' : 'Select a conversation'}
              description={
                isTicketScope
                  ? 'Choose a ticket from the list to view and reply.'
                  : 'Choose a conversation from the list to view and reply.'
              }
            />
          </div>
        )}
      </div>

      {bulkBarVisible && (
        <BulkActionBar
          count={hasSelection ? selectedIds.size : 1}
          solo={!hasSelection}
          pending={bulk.isPending}
          openMenu={bulkMenu}
          onOpenMenuChange={setBulkMenu}
          onClear={clearSelection}
          onAssign={applyAssign}
          onAssignTeam={applyAssignTeam}
          onPriority={applyPriority}
          onSnooze={applySnooze}
          onClose={applyClose}
          disableSnooze={hasTicketTarget}
        />
      )}

      <InboxCommandBar
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onAction={onInboxAction}
        hasSelection={hasSelection}
        hasActiveConversation={hasActiveConversation}
        hasTicketTarget={hasTicketTarget}
        hasLinkedTicket={!!activeLinkedTicket}
        linkedTicketNumber={activeLinkedTicket?.number}
        copilotAvailable={copilotAvailable}
      />
      <ShortcutHelpPanel
        open={helpOpen}
        onOpenChange={setHelpOpen}
        copilotAvailable={copilotAvailable}
      />
    </div>
  )
}

/**
 * Compact company filter for the inbox list header: a dropdown over the
 * workspace companies. "All companies" clears the refinement.
 */
function CompanyInboxFilter({
  companies,
  value,
  onChange,
}: {
  companies: { id: string; name: string }[]
  value: string | undefined
  onChange: (companyId: string | undefined) => void
}) {
  const active = companies.find((co) => co.id === value)
  return (
    <div className="flex items-center gap-1.5 border-b border-border/50 px-3 py-2">
      <BuildingOffice2Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Filter by company"
            className={cn(
              'inline-flex min-w-0 shrink items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium transition-colors',
              value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            )}
          >
            <span className="truncate">{active?.name ?? 'All companies'}</span>
            <ChevronDownIcon className="size-3.5 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuItem onClick={() => onChange(undefined)}>All companies</DropdownMenuItem>
          {companies.map((co) => (
            <DropdownMenuItem key={co.id} onClick={() => onChange(co.id)}>
              {co.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
