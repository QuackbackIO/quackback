import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/solid'
import { isValidTypeId } from '@quackback/ids'
import type { ConversationId, ConversationMessageId } from '@quackback/ids'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import { AgentConversationThread } from '@/components/conversation/agent-conversation-thread'
import {
  agentEventChangesInboxList,
  applyAgentThreadEvent,
  type AgentThreadCache,
} from '@/components/conversation/events-reducer'
import { conversationKeys } from '@/components/conversation/query-keys'
import { ConversationListColumn } from '@/components/admin/conversation/conversation-list-column'
import { SavedMessagesColumn } from '@/components/admin/conversation/saved-messages-column'
import {
  InboxNavSidebar,
  isInboxView,
  scopeLabelFor,
  useConversationTagsWithCounts,
  useInboxSegmentsWithCounts,
} from '@/components/admin/conversation/inbox-nav-sidebar'
import {
  inboxNavKey,
  navFromSearch,
  PRIORITY_VALUES,
  type InboxNavItem,
  type InboxSearch,
  type StatusFilter,
} from '@/lib/client/conversation/inbox-scope'
import { conversationInboxQueries } from '@/lib/client/queries/conversation-inbox'
import { useConversationStream } from '@/lib/client/hooks/use-conversation-stream'
import { useConversationTyping } from '@/lib/client/hooks/use-conversation-typing'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { EmptyState } from '@/components/shared/empty-state'
import { cn } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/shared/types/settings'

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
    status:
      search.status === 'open' ||
      search.status === 'pending' ||
      search.status === 'closed' ||
      search.status === 'all'
        ? search.status
        : undefined,
    priority: PRIORITY_VALUES.includes(search.priority as ConversationPriority | 'all')
      ? (search.priority as ConversationPriority | 'all')
      : undefined,
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
    // Carries the shared `?post=` modal target (the admin layout mounts the
    // modal) so clicking an embedded post in a conversation opens it without leaving the
    // inbox. Validated to a real post id; a junk value is dropped.
    post:
      typeof search.post === 'string' && isValidTypeId(search.post, 'post')
        ? search.post
        : undefined,
  }),
  // Re-run the prefetch when the scope / filters / open conversation change, so
  // a client-side navigation re-warms the cache too. ensureQueryData is a no-op
  // when the data is still fresh, so this doesn't double-fetch.
  loaderDeps: ({ search }) => ({
    view: search.view,
    tag: search.tag,
    segment: search.segment,
    status: search.status,
    priority: search.priority,
    q: search.q,
    c: search.c,
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
    const isSaved = nav.kind === 'view' && nav.view === 'saved'
    // Best-effort: a failed prefetch (e.g. a stale `?c=`) must never break the
    // page — each is caught independently and the component's useQuery still
    // fetches client-side, degrading to today's behavior.
    const warm = (p: Promise<unknown>) => p.catch(() => undefined)
    await Promise.all([
      isSaved
        ? undefined
        : warm(
            queryClient.ensureQueryData(
              conversationInboxQueries.conversationList(nav, status, priority, search)
            )
          ),
      warm(queryClient.ensureQueryData(conversationInboxQueries.tagCounts())),
      warm(queryClient.ensureQueryData(conversationInboxQueries.segmentCounts())),
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
    status: urlStatus,
    priority: urlPriority,
    q: urlQ,
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
  // feed, a single Label, or a single Segment. Scopes are mutually exclusive;
  // tag wins over segment wins over view if the URL somehow carries more than
  // one. Status/priority chips refine WITHIN it; Mentions is a self-contained
  // feed so those chips are hidden.
  const nav = useMemo<InboxNavItem>(
    () => navFromSearch({ tag: urlTag, segment: urlSegment, view: urlView }),
    [urlTag, urlSegment, urlView]
  )
  // Per-scope memory: each scope (view / tag / segment, keyed by inboxNavKey)
  // remembers the conversation last open in it, so returning to a scope resumes
  // where you left off instead of carrying a now-out-of-scope thread across or
  // dropping to an empty pane. Session-scoped (a refresh restores the current
  // scope + conversation from the URL). It only ever re-opens a conversation you
  // yourself had open here — never auto-opens an arbitrary unread one — so it
  // can't silently clear unread badges the way auto-opening the top would.
  const scopeMemory = useRef<Map<string, ConversationId>>(new Map())
  // Selecting any scope clears the other two so exactly one stays in the URL,
  // and resumes that scope's last-open conversation (or clears to the empty
  // state when there's nothing remembered).
  const setNav = useCallback(
    (item: InboxNavItem) =>
      updateSearch({
        view: item.kind === 'view' ? item.view : undefined,
        tag: item.kind === 'tag' ? item.tagId : undefined,
        segment: item.kind === 'segment' ? item.segmentId : undefined,
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

  // The status/priority chips apply to every scope except the Mentions feed
  // (tag + segment scopes both refine by status/priority).
  const showRefinements = nav.kind !== 'view' || nav.view !== 'mentions'
  const { data: navTags } = useConversationTagsWithCounts()
  const { data: navSegments } = useInboxSegmentsWithCounts()
  const scopeLabel = scopeLabelFor(nav, navTags, navSegments)

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
  const { data: listData, isLoading: listLoading } = useQuery({
    ...conversationInboxQueries.conversationList(nav, status, priorityFilter, search),
    refetchInterval: 30_000, // polling fallback if the stream drops
    enabled: !isSaved,
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

  // If the active tag/segment scope no longer exists (deleted here or by another
  // agent, or a stale deep-link to a removed id), fall back to the default view
  // instead of stranding the user on an empty, unlabelled scope. Guarded on the
  // option list having loaded so a valid scope isn't reset mid-fetch.
  useEffect(() => {
    if (nav.kind === 'tag' && navTags && !navTags.some((t) => t.id === nav.tagId)) {
      updateSearch({ tag: undefined })
    } else if (
      nav.kind === 'segment' &&
      navSegments &&
      !navSegments.some((s) => s.id === nav.segmentId)
    ) {
      updateSearch({ segment: undefined })
    }
  }, [nav, navTags, navSegments, updateSearch])

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

  return (
    <div className="flex h-full">
      <InboxNavSidebar nav={nav} onSelect={setNav} search={searchInput} onSearch={setSearchInput} />
      {isSaved ? (
        <SavedMessagesColumn selectedConversationId={selectedId} onSelect={selectSavedMessage} />
      ) : (
        <ConversationListColumn
          nav={nav}
          onSelectNav={setNav}
          scopeLabel={scopeLabel}
          showRefinements={showRefinements}
          searchInput={searchInput}
          onSearchInput={setSearchInput}
          status={status}
          onStatus={setStatus}
          priorityFilter={priorityFilter}
          onPriorityFilter={setPriorityFilter}
          loading={listLoading}
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}

      {/* Thread */}
      <div className={cn('min-w-0 flex-1', !selectedId && 'hidden md:block')}>
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
    </div>
  )
}
