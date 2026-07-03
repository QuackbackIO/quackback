import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChatBubbleLeftRightIcon, ChevronDownIcon } from '@heroicons/react/24/solid'
import { BuildingOffice2Icon } from '@heroicons/react/24/outline'
import { isValidTypeId } from '@quackback/ids'
import type { ConversationId, ConversationMessageId, CompanyId } from '@quackback/ids'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import {
  isConversationSort,
  viewFiltersToListParams,
  type ConversationSort,
  type ConversationViewDTO,
} from '@/lib/shared/conversation/views'
import { AgentConversationThread } from '@/components/conversation/agent-conversation-thread'
import {
  agentEventChangesInboxList,
  applyAgentThreadEvent,
  type AgentThreadCache,
} from '@/components/conversation/events-reducer'
import { conversationKeys } from '@/components/conversation/query-keys'
import { ConversationListColumn } from '@/components/admin/conversation/conversation-list-column'
import { SavedMessagesColumn } from '@/components/admin/conversation/saved-messages-column'
import { BulkActionBar, type BulkMenuId } from '@/components/admin/conversation/bulk-action-bar'
import { InboxCommandBar } from '@/components/admin/conversation/inbox-command-bar'
import { ShortcutHelpPanel } from '@/components/admin/conversation/shortcut-help-panel'
import { useInboxKeyboard } from '@/components/admin/conversation/use-inbox-keyboard'
import {
  useBulkConversationUpdate,
  type BulkConversationAction,
} from '@/lib/client/mutations/conversation-bulk'
import type { InboxActionId } from '@/lib/shared/conversation/inbox-actions'
import {
  assignConversationFn,
  setConversationPriorityFn,
  setConversationStatusFn,
  snoozeConversationFn,
} from '@/lib/server/functions/conversation'
import { assignConversationTeamFn } from '@/lib/server/functions/teams'
import {
  InboxNavSidebar,
  isInboxView,
  scopeLabelFor,
  useConversationTagsWithCounts,
  useInboxSegmentsWithCounts,
  useInboxTeams,
  useConversationViews,
} from '@/components/admin/conversation/inbox-nav-sidebar'
import { ConversationViewDialog } from '@/components/admin/conversation/conversation-view-dialog'
import {
  inboxNavKey,
  navFromSearch,
  PRIORITY_VALUES,
  type InboxNavItem,
  type InboxSearch,
  type StatusFilter,
  type AiBucket,
} from '@/lib/client/conversation/inbox-scope'
import { conversationInboxQueries } from '@/lib/client/queries/conversation-inbox'
import { listCompaniesFn } from '@/lib/server/functions/companies'
import { useConversationStream } from '@/lib/client/hooks/use-conversation-stream'
import { useConversationTyping } from '@/lib/client/hooks/use-conversation-typing'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { EmptyState } from '@/components/shared/empty-state'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/shared/types/settings'

/** Quinn-view outcome sub-filter (Fin's All / Pending / Escalated / Resolved). */
const QUINN_BUCKETS: { value: AiBucket | undefined; label: string }[] = [
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
  value?: AiBucket
  counts?: { resolved: number; escalated: number; pending: number }
  onChange: (value?: AiBucket) => void
}) {
  const countFor = (v?: AiBucket): number | undefined => {
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
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
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
  // `?c=<conversationId>` deep-links a conversation open (e.g. from a user
  // profile). `?view=`/`?tag=` deep-link the left-nav scope so it survives a
  // refresh and is shareable. All optional, so existing `{ c }` links still type.
  // Everything that defines the current view lives in the URL so a refresh
  // restores the exact open conversation + filters, and links are shareable.
  validateSearch: (search: Record<string, unknown>): InboxSearch => ({
    c: typeof search.c === 'string' ? search.c : undefined,
    // Only accept a well-formed conversation-message id — a stray `?m=` is harmless
    // (the thread just won't find it), but validating keeps it tidy.
    m:
      typeof search.m === 'string' && isValidTypeId(search.m, 'conversation_msg')
        ? search.m
        : undefined,
    // Allowlist tracks CONVERSATION_VIEWS (incl. 'saved') so deep-links can't
    // silently drop a real view and fall back to the conversation list.
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
    status:
      search.status === 'open' ||
      search.status === 'snoozed' ||
      search.status === 'closed' ||
      search.status === 'all'
        ? search.status
        : undefined,
    priority: PRIORITY_VALUES.includes(search.priority as ConversationPriority | 'all')
      ? (search.priority as ConversationPriority | 'all')
      : undefined,
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
  }),
  // Re-run the prefetch when the scope / filters / open conversation change, so
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
    ai: search.ai,
    q: search.q,
    c: search.c,
    company: search.company,
  }),
  loader: async ({ deps, context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
    const flags = context.settings?.featureFlags as FeatureFlags | undefined
    // The component redirects when the flag is off — don't pay for a prefetch.
    if (!flags?.supportInbox) return {}
    const { queryClient } = context
    const nav = navFromSearch(deps)
    const status = deps.status ?? 'open'
    const priority = deps.priority ?? 'all'
    const search = (deps.q ?? '').trim()
    const sort = deps.sort ?? 'recent'
    const isSaved = nav.kind === 'view' && nav.view === 'saved'
    // A custom view's list depends on its rule set (loaded client-side from the
    // views list), so — like Saved — it hydrates client-side, not here.
    const skipListPrefetch = isSaved || nav.kind === 'custom'
    // A `?company=` deep link SSR-prefetches the FILTERED list under the same
    // factory key the component reads, so the filtered view hydrates too.
    const company = deps.company as CompanyId | undefined
    // Best-effort: a failed prefetch (e.g. a stale `?c=`) must never break the
    // page — each is caught independently and the component's useQuery still
    // fetches client-side, degrading to today's behavior.
    const warm = (p: Promise<unknown>) => p.catch(() => undefined)
    await Promise.all([
      skipListPrefetch
        ? undefined
        : warm(
            queryClient.ensureQueryData(
              conversationInboxQueries.conversationList(
                nav,
                status,
                priority,
                search,
                company,
                sort,
                undefined,
                deps.ai
              )
            )
          ),
      warm(queryClient.ensureQueryData(conversationInboxQueries.tagCounts())),
      warm(queryClient.ensureQueryData(conversationInboxQueries.segmentCounts())),
      warm(queryClient.ensureQueryData(conversationInboxQueries.views())),
      deps.c
        ? warm(
            queryClient.ensureQueryData(conversationInboxQueries.thread(deps.c as ConversationId))
          )
        : undefined,
    ])
    return {}
  },
  component: InboxRoute,
})

/**
 * Gate the inbox behind the experimental `supportInbox` flag (off by default), mirroring
 * the help-center route. Wrapping keeps the flag check above the inbox's hooks
 * so they aren't conditionally called.
 */
function InboxRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) {
    return <Navigate to="/admin/feedback" />
  }
  return <InboxPage />
}

function InboxPage() {
  const queryClient = useQueryClient()
  const navigate = Route.useNavigate()
  const {
    c: urlC,
    m: urlM,
    view: urlView,
    tag: urlTag,
    segment: urlSegment,
    team: urlTeam,
    viewId: urlViewId,
    sort: urlSort,
    status: urlStatus,
    priority: urlPriority,
    q: urlQ,
    company: urlCompany,
    ai: urlAi,
    post: urlPost,
  } = Route.useSearch()

  // The URL is the single source of truth for the open conversation + filters,
  // so a refresh restores the exact view and any link is shareable. Every
  // selection merges into the search params (replace, so it doesn't spam
  // history) and the values below are derived straight back from the URL.
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
  // feed, a Label, a Segment, a per-team inbox, or a custom saved view. Scopes
  // are mutually exclusive; precedence custom > team > tag > segment > view.
  // Status/priority chips refine WITHIN a built-in scope; Mentions + custom
  // views are self-contained so those chips are hidden.
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
  // remembers the conversation last open in it, so returning to a scope resumes
  // where you left off instead of carrying a now-out-of-scope thread across or
  // dropping to an empty pane. Session-scoped (a refresh restores the current
  // scope + conversation from the URL). It only ever re-opens a conversation you
  // yourself had open here — never auto-opens an arbitrary unread one — so it
  // can't silently clear unread badges the way auto-opening the top would.
  const scopeMemory = useRef<Map<string, ConversationId>>(new Map())
  // Selecting any scope clears the others so exactly one stays in the URL, and
  // resumes that scope's last-open conversation (or clears to the empty state
  // when there's nothing remembered).
  const setNav = useCallback(
    (item: InboxNavItem) =>
      updateSearch({
        view: item.kind === 'view' ? item.view : undefined,
        tag: item.kind === 'tag' ? item.tagId : undefined,
        segment: item.kind === 'segment' ? item.segmentId : undefined,
        team: item.kind === 'team' ? item.teamId : undefined,
        viewId: item.kind === 'custom' ? item.viewId : undefined,
        c: scopeMemory.current.get(inboxNavKey(item)),
        m: undefined,
      }),
    [updateSearch]
  )

  const status: StatusFilter = urlStatus ?? 'open'
  const setStatus = useCallback(
    (s: StatusFilter) => updateSearch({ status: s === 'open' ? undefined : s }),
    [updateSearch]
  )
  const priorityFilter: ConversationPriority | 'all' = urlPriority ?? 'all'
  const setPriorityFilter = useCallback(
    (p: ConversationPriority | 'all') => updateSearch({ priority: p === 'all' ? undefined : p }),
    [updateSearch]
  )
  const setSort = useCallback(
    (s: ConversationSort) => updateSearch({ sort: s === 'recent' ? undefined : s }),
    [updateSearch]
  )
  const selectedId = (urlC as ConversationId | undefined) ?? null
  // Selecting a conversation clears any stale jump target — `?m=` only ever
  // pairs with the conversation it was opened from (via selectSavedMessage).
  const setSelectedId = useCallback(
    (id: ConversationId | null) => updateSearch({ c: id ?? undefined, m: undefined }),
    [updateSearch]
  )
  // Open a conversation AND deep-link a specific message (the "Saved for later"
  // feed): the thread scrolls to it and flashes it on arrival.
  const targetMessageId = (urlM as ConversationMessageId | undefined) ?? null
  const selectSavedMessage = useCallback(
    (conversationId: ConversationId, messageId: ConversationMessageId) =>
      updateSearch({ c: conversationId, m: messageId }),
    [updateSearch]
  )

  // Open an embedded post (clicked in a conversation message) in the in-place
  // `?post=` modal the admin layout mounts — route-bound + search-only, so it
  // stays on /admin/inbox with `?c=` intact, and closing returns to the exact
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
  const customParams = useMemo(
    () => (activeView ? viewFiltersToListParams(activeView.filters) : undefined),
    [activeView]
  )
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

  // The list query comes straight from the shared factory: the unfiltered case
  // keeps hydrating from the loader's SSR prefetch (identical key), and a
  // selected company appends to the key + params without leaving the
  // agentConversations() prefix that SSE invalidations target.
  const { data: listData, isLoading: listLoading } = useQuery({
    ...conversationInboxQueries.conversationList(
      nav,
      status,
      priorityFilter,
      search,
      urlCompany as CompanyId | undefined,
      sort,
      customParams,
      nav.kind === 'view' && nav.view === 'quinn' ? urlAi : undefined
    ),
    refetchInterval: 30_000, // polling fallback if the stream drops
    // Saved shows flagged messages (no list). A custom view can't run until its
    // rule set has loaded from the views list, so hold the query until then.
    enabled: !isSaved && (nav.kind !== 'custom' || !!activeView),
  })

  // Quinn-view sub-filter counts (only fetched while that view is open).
  const isQuinnView = nav.kind === 'view' && nav.view === 'quinn'
  const { data: assistantCounts } = useQuery({
    ...conversationInboxQueries.assistantCounts(),
    enabled: isQuinnView,
  })

  const conversations = listData?.conversations ?? []

  // Keep the active scope's memory in sync with what's open, so it's current the
  // moment you switch away. Only remember a conversation that's actually IN this
  // scope's list — a cross-scope deep-link (`?c=X` paired with an unrelated
  // `?tag=`) must not pollute the scope's memory and resurface out of scope.
  // (A conversation below the first page simply isn't remembered — recent ones
  // dominate.) Closing a conversation forgets it for the scope.
  useEffect(() => {
    const key = inboxNavKey(nav)
    if (selectedId && conversations.some((c) => c.id === selectedId)) {
      scopeMemory.current.set(key, selectedId)
    } else if (!selectedId) {
      scopeMemory.current.delete(key)
    }
  }, [nav, selectedId, conversations])

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

  // Live updates for the whole inbox over one cookie-authenticated stream.
  const refreshInbox = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: conversationKeys.agentConversations() })
  }, [queryClient])

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

  useConversationStream({
    enabled: true,
    buildUrl: async () => '/api/chat/stream?scope=inbox',
    onReconnect: refreshInbox,
    onEvent: (evt) => {
      // Refetch the inbox list only for events that change its ordering /
      // preview / unread badge (the reducer module owns the predicate).
      if (agentEventChangesInboxList(evt)) refreshInbox()

      // Typing indicators are component state, not cache: a visitor message
      // clears the visitor dots; agent activity clears the collision notice
      // (self-echo is dropped server-side, so it's always another agent).
      if (evt.kind === 'message' && evt.conversationId === selectedId) {
        if (evt.message.senderType === 'visitor') clearRemoteTyping()
        if (evt.message.senderType === 'agent') clearOtherAgentTyping()
      } else if (evt.kind === 'typing' && evt.conversationId === selectedId) {
        if (evt.side === 'visitor') onRemoteTyping()
        else if (evt.side === 'agent') onOtherAgentTyping()
      }

      // Everything cache-shaped (message/read/updated/deleted/conversation)
      // routes through the pure reducer against the open thread's cache.
      if (selectedId) {
        queryClient.setQueryData(
          conversationKeys.agentThread(selectedId),
          (prev: AgentThreadCache | undefined) => applyAgentThreadEvent(prev, evt, selectedId)
        )
      }
    },
  })

  // ── Keyboard-first layer + bulk selection (support platform §4.6) ────────
  // Multi-select set (bulk actions). Cleared whenever the scope/filters change
  // so a stale id from a different list can never be acted on, and after a fully
  // successful bulk apply.
  const [selectedIds, setSelectedIds] = useState<Set<ConversationId>>(() => new Set())
  const hasSelection = selectedIds.size > 0
  const hasActiveConversation = !!selectedId
  // Which value menu the floating bar shows open — driven by the command bar /
  // keyboard so a single keypress can pop the right picker.
  const [bulkMenu, setBulkMenu] = useState<BulkMenuId | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // Anchor for shift-click range selection.
  const selectAnchor = useRef<ConversationId | null>(null)
  // The thread wrapper, so the reply action can focus the open composer.
  const threadContainerRef = useRef<HTMLDivElement>(null)
  const bulk = useBulkConversationUpdate()

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setBulkMenu(null)
    selectAnchor.current = null
  }, [])

  // Reset the selection when the visible list changes (scope / status / priority
  // / company / search) — the checked ids belong to the previous list. The
  // first-mount clear is harmless (the selection starts empty).
  const selectionScopeKey = `${inboxNavKey(nav)}|${status}|${priorityFilter}|${urlCompany ?? ''}|${search}`
  useEffect(() => {
    clearSelection()
  }, [selectionScopeKey, clearSelection])

  const toggleSelect = useCallback(
    (id: ConversationId, opts?: { range?: boolean }) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        const ids = conversations.map((c) => c.id)
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
    [conversations]
  )

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = conversations.length > 0 && conversations.every((c) => prev.has(c.id))
      return allSelected ? new Set() : new Set(conversations.map((c) => c.id))
    })
  }, [conversations])

  // Toast the bulk summary: a clean line on full success, a partial-failure count
  // otherwise. Verb is the past-tense action word ("Closed", "Snoozed", …).
  const summarize = useCallback((verb: string, ok: number, fail: number) => {
    if (fail === 0) {
      toast.success(`${verb} ${ok} ${ok === 1 ? 'conversation' : 'conversations'}`)
    } else {
      toast.warning(`${ok} updated, ${fail} failed`)
    }
  }, [])

  const runBulk = useCallback(
    async (action: BulkConversationAction, verb: string) => {
      const ids = [...selectedIds]
      if (ids.length === 0) return
      try {
        const res = await bulk.mutateAsync({ conversationIds: ids, action })
        summarize(verb, res.succeeded.length, res.failed.length)
        if (res.failed.length === 0) clearSelection()
        else setBulkMenu(null)
      } catch {
        toast.error('Bulk action failed')
      }
    },
    [selectedIds, bulk, summarize, clearSelection]
  )

  // Apply a single-conversation action for the solo (no-selection) case: run its
  // own server fn, refresh the inbox, and toast the outcome. Always dismisses any
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

  // Each control targets the multi-selection when there is one (runBulk), else the
  // single open conversation via its own server fn (runSolo).
  const applyAssign = useCallback(
    async (assignTo: string | null) => {
      if (hasSelection) return runBulk({ type: 'assign', assignTo }, 'Assigned')
      if (!selectedId) return
      return runSolo(
        () => assignConversationFn({ data: { conversationId: selectedId, assignTo } }),
        { success: 'Conversation assigned', error: 'Failed to assign conversation' }
      )
    },
    [hasSelection, selectedId, runBulk, runSolo]
  )

  const applyAssignTeam = useCallback(
    async (teamId: string) => {
      if (hasSelection) return runBulk({ type: 'assign_team', teamId }, 'Assigned')
      if (!selectedId) return
      return runSolo(
        () => assignConversationTeamFn({ data: { conversationId: selectedId, teamId } }),
        { success: 'Assigned to team', error: 'Failed to assign team' }
      )
    },
    [hasSelection, selectedId, runBulk, runSolo]
  )

  const applyPriority = useCallback(
    async (priority: ConversationPriority) => {
      if (hasSelection) return runBulk({ type: 'priority', priority }, 'Updated')
      if (!selectedId) return
      return runSolo(
        () => setConversationPriorityFn({ data: { conversationId: selectedId, priority } }),
        { success: 'Priority updated', error: 'Failed to set priority' }
      )
    },
    [hasSelection, selectedId, runBulk, runSolo]
  )

  const applySnooze = useCallback(
    async (until: string | null) => {
      if (hasSelection) return runBulk({ type: 'snooze', until }, 'Snoozed')
      if (!selectedId) return
      return runSolo(() => snoozeConversationFn({ data: { conversationId: selectedId, until } }), {
        success: 'Conversation snoozed',
        error: 'Failed to snooze conversation',
      })
    },
    [hasSelection, selectedId, runBulk, runSolo]
  )

  const applyClose = useCallback(async () => {
    if (hasSelection) return runBulk({ type: 'close' }, 'Closed')
    if (!selectedId) return
    return runSolo(
      () => setConversationStatusFn({ data: { conversationId: selectedId, status: 'closed' } }),
      { success: 'Conversation closed', error: 'Failed to close conversation' }
    )
  }, [hasSelection, selectedId, runBulk, runSolo])

  const applyReopen = useCallback(async () => {
    if (hasSelection) return runBulk({ type: 'reopen' }, 'Reopened')
    if (!selectedId) return
    return runSolo(
      () => setConversationStatusFn({ data: { conversationId: selectedId, status: 'open' } }),
      { success: 'Conversation reopened', error: 'Failed to reopen conversation' }
    )
  }, [hasSelection, selectedId, runBulk, runSolo])

  // Focus the open thread's composer (the single contenteditable inside it). The
  // `.ProseMirror` selector couples to the editor's internals; the proper fix is a
  // composer imperative handle (next wave).
  const focusComposer = useCallback(() => {
    threadContainerRef.current
      ?.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]')
      ?.focus()
  }, [])

  // j / k: move the open conversation to the next / previous row in the list.
  const moveSelection = useCallback(
    (delta: number) => {
      if (conversations.length === 0) return
      const idx = conversations.findIndex((c) => c.id === selectedId)
      const nextIdx =
        idx < 0
          ? delta > 0
            ? 0
            : conversations.length - 1
          : Math.min(Math.max(idx + delta, 0), conversations.length - 1)
      setSelectedId(conversations[nextIdx].id)
    },
    [conversations, selectedId, setSelectedId]
  )

  // The single action router shared by the command bar and the keyboard hook.
  // Both-scope value actions (assign/team/priority/snooze) pop the matching menu
  // in the floating bar (targeting the selection, or the single open thread);
  // close/reopen apply immediately. See the report for the value-action UX note.
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
          if (needsTarget) setBulkMenu('snooze')
          break
        case 'close':
          if (needsTarget) void applyClose()
          break
        case 'reopen':
          if (needsTarget) void applyReopen()
          break
      }
    },
    [
      hasSelection,
      hasActiveConversation,
      focusComposer,
      moveSelection,
      selectedId,
      toggleSelect,
      applyClose,
      applyReopen,
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
  // popped for the single open conversation.
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
      {isSaved ? (
        <SavedMessagesColumn selectedConversationId={selectedId} onSelect={selectSavedMessage} />
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
                onChange={(ai) => updateSearch({ ai, c: undefined, m: undefined })}
              />
            ) : companies && companies.length > 0 ? (
              <CompanyInboxFilter
                companies={companies}
                value={urlCompany}
                onChange={(id) => updateSearch({ company: id, c: undefined, m: undefined })}
              />
            ) : undefined
          }
          searchInput={searchInput}
          onSearchInput={setSearchInput}
          status={status}
          onStatus={setStatus}
          priorityFilter={priorityFilter}
          onPriorityFilter={setPriorityFilter}
          sort={sort}
          onSort={setSort}
          loading={listLoading}
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          selectionActive={hasSelection}
        />
      )}

      {/* Thread */}
      <div
        ref={threadContainerRef}
        className={cn('min-w-0 flex-1', !selectedId && 'hidden md:block')}
      >
        {selectedId ? (
          <AgentConversationThread
            key={selectedId}
            conversationId={selectedId}
            targetMessageId={targetMessageId}
            onChanged={refreshInbox}
            onBack={() => setSelectedId(null)}
            onSelectConversation={setSelectedId}
            onOpenPost={openPost}
            isVisitorTyping={visitorTyping}
            isOtherAgentTyping={otherAgentTyping}
          />
        ) : (
          <div className="hidden h-full items-center justify-center md:flex">
            <EmptyState
              icon={ChatBubbleLeftRightIcon}
              title="Select a conversation"
              description="Choose a conversation from the list to view and reply."
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
        />
      )}

      <InboxCommandBar
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onAction={onInboxAction}
        hasSelection={hasSelection}
        hasActiveConversation={hasActiveConversation}
      />
      <ShortcutHelpPanel open={helpOpen} onOpenChange={setHelpOpen} />
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
              'inline-flex min-w-0 shrink items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
              value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            )}
          >
            <span className="truncate">{active?.name ?? 'All companies'}</span>
            <ChevronDownIcon className="h-3 w-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuItem onClick={() => onChange(undefined)} className="text-xs">
            All companies
          </DropdownMenuItem>
          {companies.map((co) => (
            <DropdownMenuItem key={co.id} onClick={() => onChange(co.id)} className="text-xs">
              {co.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
