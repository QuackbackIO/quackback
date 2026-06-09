import { createFileRoute, Navigate, useRouteContext } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  XMarkIcon,
  ChatBubbleBottomCenterTextIcon,
  PencilSquareIcon,
  ChevronLeftIcon,
} from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { isValidTypeId } from '@quackback/ids'
import type { ConversationId, ChatMessageId } from '@quackback/ids'
import {
  listChatMessagesFn,
  sendAgentMessageFn,
  addChatNoteFn,
  markChatReadFn,
  sendChatTypingFn,
  getCannedRepliesFn,
  deleteChatMessageFn,
  addMessageReactionFn,
  removeMessageReactionFn,
  setMessageFlagFn,
  markConversationUnreadFromMessageFn,
} from '@/lib/server/functions/chat'
import type {
  ChatAttachment,
  ChatMessageDTO,
  AgentChatMessageDTO,
  MessageReactionCount,
  ConversationDTO,
  ConversationPriority,
} from '@/lib/shared/chat/types'
import { AdminBubble, UnreadDivider } from '@/components/admin/chat/admin-bubble'
import { PriorityControl } from '@/components/admin/chat/priority-control'
import { AssigneeControl } from '@/components/admin/chat/assignee-control'
import { ChannelBadge } from '@/components/admin/chat/channel-badge'
import { ConversationTagsEditor } from '@/components/admin/chat/conversation-tags-editor'
import { StatusControl } from '@/components/admin/chat/status-control'
import { ConversationDetailPanel } from '@/components/admin/chat/conversation-detail-panel'
import { ConvertToPostDialog } from '@/components/admin/chat/convert-to-post-dialog'
import { SharePostDialog } from '@/components/admin/chat/share-post-dialog'
import { ConversationListColumn } from '@/components/admin/chat/conversation-list-column'
import { SavedMessagesColumn } from '@/components/admin/chat/saved-messages-column'
import { ChatNoteEditor, type ChatNoteEditorHandle } from '@/components/admin/chat/chat-note-editor'
import {
  ChatRichComposer,
  type ChatRichComposerHandle,
} from '@/components/admin/chat/chat-rich-composer'
import {
  InboxNavSidebar,
  isInboxView,
  scopeLabelFor,
  useChatTagsWithCounts,
  useInboxSegmentsWithCounts,
} from '@/components/admin/chat/inbox-nav-sidebar'
import {
  inboxNavKey,
  navFromSearch,
  PRIORITY_VALUES,
  type InboxNavItem,
  type InboxSearch,
  type StatusFilter,
} from '@/lib/client/chat/inbox-scope'
import { chatInboxQueries } from '@/lib/client/queries/chat-inbox'
import type { JSONContent } from '@tiptap/core'
import { useChatStream } from '@/lib/client/hooks/use-chat-stream'
import { useChatTyping } from '@/lib/client/hooks/use-chat-typing'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import { useChatComposerAttachments } from '@/lib/client/hooks/use-chat-composer-attachments'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { TypingDots } from '@/components/shared/typing-dots'
import { EmojiPicker } from '@/components/shared/emoji-picker'
import { Avatar } from '@/components/ui/avatar'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
    // Only accept a well-formed chat-message id — a stray `?m=` is harmless
    // (the thread just won't find it), but validating keeps it tidy.
    m: typeof search.m === 'string' && isValidTypeId(search.m, 'chat_msg') ? search.m : undefined,
    // Allowlist tracks CONVERSATION_VIEWS (incl. 'saved') so deep-links can't
    // silently drop a real view and fall back to the conversation list.
    view: isInboxView(search.view) ? search.view : undefined,
    // Only accept a well-formed chat-tag id — a malformed `?tag=` would reach a
    // uuid-backed query and 500 the conversation list.
    tag:
      typeof search.tag === 'string' && isValidTypeId(search.tag, 'chat_tag')
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
    // modal) so clicking an embedded post in a chat opens it without leaving the
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
              chatInboxQueries.conversationList(nav, status, priority, search)
            )
          ),
      warm(queryClient.ensureQueryData(chatInboxQueries.tagCounts())),
      warm(queryClient.ensureQueryData(chatInboxQueries.segmentCounts())),
      deps.c
        ? warm(queryClient.ensureQueryData(chatInboxQueries.thread(deps.c as ConversationId)))
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
  const targetMessageId = (urlM as ChatMessageId | undefined) ?? null
  const selectSavedMessage = useCallback(
    (conversationId: ConversationId, messageId: ChatMessageId) =>
      updateSearch({ c: conversationId, m: messageId }),
    [updateSearch]
  )

  // The status/priority chips apply to every scope except the Mentions feed
  // (tag + segment scopes both refine by status/priority).
  const showRefinements = nav.kind !== 'view' || nav.view !== 'mentions'
  const { data: navTags } = useChatTagsWithCounts()
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
    ...chatInboxQueries.conversationList(nav, status, priorityFilter, search),
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
    void queryClient.invalidateQueries({ queryKey: ['admin', 'inbox', 'conversations'] })
  }, [queryClient])

  // Track whether the visitor of the selected conversation is currently typing.
  const { remoteTyping: visitorTyping, onRemoteTyping, clearRemoteTyping } = useChatTyping(() => {})
  // Collision detection: another agent typing in the same thread (self-echo is
  // filtered server-side, so any agent-typing here is a different agent).
  const {
    remoteTyping: otherAgentTyping,
    onRemoteTyping: onOtherAgentTyping,
    clearRemoteTyping: clearOtherAgentTyping,
  } = useChatTyping(() => {})

  useChatStream({
    enabled: true,
    buildUrl: async () => '/api/chat/stream?scope=inbox',
    onReconnect: refreshInbox,
    onEvent: (evt) => {
      // Refetch the inbox list only for events that change its ordering / preview
      // / unread badge: new + deleted messages, conversation updates, and an
      // AGENT read move (mark-unread). typing, visitor-read ("Seen"), and
      // message_updated (reaction/flag) only touch the open thread.
      const changesInboxList =
        (evt.kind !== 'read' && evt.kind !== 'typing' && evt.kind !== 'message_updated') ||
        (evt.kind === 'read' && evt.side === 'agent')
      if (changesInboxList) refreshInbox()

      if (evt.kind === 'message' && evt.conversationId === selectedId) {
        if (evt.message.senderType === 'visitor') clearRemoteTyping()
        if (evt.message.senderType === 'agent') clearOtherAgentTyping()
        queryClient.setQueryData(
          ['admin', 'inbox', 'thread', selectedId],
          (prev: ThreadCache | undefined) => {
            if (!prev) return prev
            if (prev.messages.some((m) => m.id === evt.message.id)) return prev
            return { ...prev, messages: [...prev.messages, asAgentMessage(evt.message)] }
          }
        )
      } else if (
        evt.kind === 'typing' &&
        evt.conversationId === selectedId &&
        evt.side === 'visitor'
      ) {
        onRemoteTyping()
      } else if (
        evt.kind === 'typing' &&
        evt.conversationId === selectedId &&
        evt.side === 'agent'
      ) {
        // Self-echo is dropped server-side, so this is always another agent.
        onOtherAgentTyping()
      } else if (evt.kind === 'read' && evt.conversationId === selectedId) {
        // Advance the read watermark for the relevant side: visitor → the agent's
        // "Seen" updates live; agent → the unread divider repositions (e.g. when
        // another agent marks the thread unread).
        const field = evt.side === 'visitor' ? 'visitorLastReadAt' : 'agentLastReadAt'
        queryClient.setQueryData(
          ['admin', 'inbox', 'thread', selectedId],
          (prev: ThreadCache | undefined) =>
            prev ? { ...prev, conversation: { ...prev.conversation, [field]: evt.at } } : prev
        )
      } else if (evt.kind === 'message_updated' && evt.conversationId === selectedId) {
        // A reaction or flag changed on an existing message — patch it in place,
        // preserving OUR own hasReacted (the broadcast carries the actor's view).
        queryClient.setQueryData(
          ['admin', 'inbox', 'thread', selectedId],
          (prev: ThreadCache | undefined) =>
            prev
              ? {
                  ...prev,
                  messages: prev.messages.map((m) =>
                    m.id === evt.message.id ? mergeAgentMessage(m, evt.message) : m
                  ),
                }
              : prev
        )
      } else if (evt.kind === 'message_deleted' && evt.conversationId === selectedId) {
        queryClient.setQueryData(
          ['admin', 'inbox', 'thread', selectedId],
          (prev: ThreadCache | undefined) =>
            prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== evt.messageId) } : prev
        )
      } else if (evt.kind === 'conversation' && evt.conversation.id === selectedId) {
        // Keep the open thread in sync with changes another agent made. The agent
        // DTO carries fresh tags too, so a foreign label change propagates here —
        // tag mutations have no dedicated broadcast, so they ride on the next
        // conversation event. Adopting it wholesale can briefly overwrite a tag
        // THIS client just applied locally if a foreign metadata event interleaves;
        // we accept that narrow, self-healing race rather than leave other agents'
        // labels invisible until reload (reliable sync would need a tag broadcast).
        queryClient.setQueryData(
          ['admin', 'inbox', 'thread', selectedId],
          (prev: ThreadCache | undefined) =>
            prev ? { ...prev, conversation: evt.conversation } : prev
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
          <ChatThread
            key={selectedId}
            conversationId={selectedId}
            targetMessageId={targetMessageId}
            onChanged={refreshInbox}
            onBack={() => setSelectedId(null)}
            onSelectConversation={setSelectedId}
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

/** The agent thread cache: messages are AgentChatMessageDTO (reactions + flag). */
type ThreadCache = {
  conversation: ConversationDTO
  messages: AgentChatMessageDTO[]
  hasMore?: boolean
}

/** Coerce a base/partial message DTO to an agent one, preserving any reaction /
 *  flag fields it already carries (a fresh message has neither yet). */
function asAgentMessage(m: ChatMessageDTO | AgentChatMessageDTO): AgentChatMessageDTO {
  return {
    ...m,
    reactions: 'reactions' in m ? m.reactions : [],
    flaggedAt: 'flaggedAt' in m ? m.flaggedAt : null,
    postSuggestion: 'postSuggestion' in m ? m.postSuggestion : null,
  }
}

/** Apply an incoming message_updated to a cached message: take its reaction
 *  counts but keep OUR own hasReacted and OUR own flag — both are viewer-relative
 *  (reactions per-user, flags per-agent), so the broadcaster's values are not
 *  ours to apply. */
function mergeAgentMessage(
  local: AgentChatMessageDTO,
  incoming: AgentChatMessageDTO
): AgentChatMessageDTO {
  const localReacted = new Set(local.reactions.filter((r) => r.hasReacted).map((r) => r.emoji))
  return {
    ...incoming,
    reactions: incoming.reactions.map((r) => ({ ...r, hasReacted: localReacted.has(r.emoji) })),
    flaggedAt: local.flaggedAt,
  }
}

/** True when the composer doc carries an inline image or post embed, which makes
 *  a message worth sending even with no typed text. Walks the doc since these are
 *  block atoms at the top level (and defensively, any nesting). */
function replyDocHasContentNode(doc: JSONContent | null): boolean {
  if (!doc) return false
  const walk = (nodes: JSONContent[] | undefined): boolean =>
    !!nodes?.some((n) => n.type === 'chatImage' || n.type === 'quackbackEmbed' || walk(n.content))
  return walk(doc.content)
}

/** Optimistically toggle the caller's reaction with `emoji` on a message,
 *  attributing it to `myName` so the chip's hover tooltip is right immediately
 *  (the mutation's onSuccess then reconciles to the server's canonical list). */
function toggleReactionLocal(
  m: AgentChatMessageDTO,
  emoji: string,
  hadReacted: boolean,
  myName: string
): AgentChatMessageDTO {
  let reactions: MessageReactionCount[]
  if (hadReacted) {
    reactions = m.reactions
      .map((r) =>
        r.emoji === emoji
          ? {
              ...r,
              count: r.count - 1,
              hasReacted: false,
              reactors: (r.reactors ?? []).filter((n) => n !== myName),
            }
          : r
      )
      .filter((r) => r.count > 0)
  } else if (m.reactions.some((r) => r.emoji === emoji)) {
    reactions = m.reactions.map((r) =>
      r.emoji === emoji
        ? { ...r, count: r.count + 1, hasReacted: true, reactors: [...(r.reactors ?? []), myName] }
        : r
    )
  } else {
    reactions = [...m.reactions, { emoji, count: 1, hasReacted: true, reactors: [myName] }]
  }
  return { ...m, reactions }
}

// "Jump to message" tuning: how long the flash plays (must match the
// flash-highlight keyframe duration) and how many older pages we'll auto-pull
// chasing a deep-linked message before giving up.
const FLASH_MS = 2200
const MAX_JUMP_PAGES = 20

function ChatThread({
  conversationId,
  targetMessageId,
  onChanged,
  onBack,
  onSelectConversation,
  isVisitorTyping,
  isOtherAgentTyping,
}: {
  conversationId: ConversationId
  /** Deep-link target: scroll to + flash this message once it's loaded. */
  targetMessageId: ChatMessageId | null
  onChanged: () => void
  /** Mobile-only: return to the conversation list (single-column layout). */
  onBack: () => void
  /** Open another conversation (e.g. from the detail panel's history). */
  onSelectConversation: (id: ConversationId) => void
  isVisitorTyping: boolean
  isOtherAgentTyping: boolean
}) {
  const queryClient = useQueryClient()
  const navigate = Route.useNavigate()
  const threadKey = ['admin', 'inbox', 'thread', conversationId] as const
  // The current agent's display name, for attributing optimistic reactions.
  const { session, settings } = useRouteContext({ from: '__root__' })
  const myName = session?.user?.name ?? 'You'
  const linkPreviewsEnabled =
    (settings?.featureFlags as FeatureFlags | undefined)?.linkPreviews ?? false

  // Open an embedded post (clicked in a chat message) in the in-place `?post=`
  // modal the admin layout mounts — route-bound + search-only, so it stays on
  // /admin/inbox with `?c=` intact, and closing returns to the exact chat.
  // Mirrors how the roadmap board opens a card; NOT `replace`, so the browser
  // back button closes the modal.
  const openPost = useCallback(
    (postId: string) => {
      void navigate({ to: '/admin/inbox', search: (prev) => ({ ...prev, post: postId }) })
    },
    [navigate]
  )
  // Reply composer is a rich TipTap doc (inline images + post embeds). `replyText`
  // is the doc's plain text (gates send + drives typing); `replyDocRef` holds the
  // doc persisted as contentJson; `replyResetSignal` clears the editor after send.
  const [replyText, setReplyText] = useState('')
  const replyDocRef = useRef<JSONContent | null>(null)
  // Reactive mirror of "doc carries an inline image/embed" so the send gate
  // enables for a no-text, image-only message (a ref read wouldn't re-render).
  const [replyHasContentNode, setReplyHasContentNode] = useState(false)
  const [replyResetSignal, setReplyResetSignal] = useState(0)
  // Composer mode: a public reply to the visitor, or an internal team note.
  const [noteMode, setNoteMode] = useState(false)
  // Internal-note composer state (separate from the plain reply textarea): the
  // note is a rich TipTap doc so it can carry @-mention chips.
  const [noteText, setNoteText] = useState('')
  const noteDocRef = useRef<JSONContent | null>(null)
  const [noteResetSignal, setNoteResetSignal] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Per-message "Track as post" quick actions: the message driving the
  // (controlled) track dialog and the share-post picker, respectively.
  const [suggestMsg, setSuggestMsg] = useState<AgentChatMessageDTO | null>(null)
  const [shareMsg, setShareMsg] = useState<AgentChatMessageDTO | null>(null)
  // An AI "Track as post" suggestion the agent accepted from a note chip: seeds
  // the same (controlled) convert dialog with the suggested board/title/content.
  const [suggestionSeed, setSuggestionSeed] = useState<{
    boardId: string
    title: string
    content: string
  } | null>(null)

  // "Jump to message" deep-link state. pendingTarget is the message we still
  // need to scroll to (null once resolved); highlightId is the one currently
  // flashing. pendingTargetRef mirrors pendingTarget so the auto-scroll-to-
  // bottom effect can read it without listing it as a dep (which would re-fire
  // a bottom-scroll the instant the jump resolves).
  const [pendingTarget, setPendingTarget] = useState<ChatMessageId | null>(targetMessageId)
  const [highlightId, setHighlightId] = useState<ChatMessageId | null>(null)
  const pendingTargetRef = useRef<ChatMessageId | null>(targetMessageId)
  pendingTargetRef.current = pendingTarget
  const jumpPagesRef = useRef(0)

  const sendTyping = useCallback(() => {
    void sendChatTypingFn({ data: { conversationId } }).catch(() => {})
  }, [conversationId])
  const { onLocalInput } = useChatTyping(sendTyping)

  const { upload } = useImageUpload({ endpoint: '/api/upload/image', prefix: 'chat-images' })
  const {
    pending: pendingAttachments,
    addFiles,
    remove: removeAttachment,
    clear: clearAttachments,
    uploading,
  } = useChatComposerAttachments(upload)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replyComposerRef = useRef<ChatRichComposerHandle>(null)
  const noteEditorRef = useRef<ChatNoteEditorHandle>(null)

  // Shared factory (same key as `threadKey`) so a `?c=` deep-link prefetched by
  // the route loader hydrates this thread on first paint.
  const { data, isLoading } = useQuery(chatInboxQueries.thread(conversationId))

  const messages = data?.messages ?? []
  const conversation = data?.conversation
  const hasMoreOlder = data?.hasMore ?? false

  // The unread divider sits immediately above the first message newer than the
  // agent's read watermark — i.e. the first message that "mark unread" or new
  // arrivals resurfaced. Null (no divider) when the thread is fully read.
  const agentLastReadAt = conversation?.agentLastReadAt
  const firstUnreadId = useMemo(() => {
    if (!agentLastReadAt) return null
    const readMs = new Date(agentLastReadAt).getTime()
    const first = messages.find(
      (m) => m.senderType !== 'system' && new Date(m.createdAt).getTime() > readMs
    )
    return first?.id ?? null
  }, [messages, agentLastReadAt])
  const [loadingOlder, setLoadingOlder] = useState(false)

  // Prepend an older page (keyset cursor = oldest loaded message id). Agents see
  // internal notes here too (listChatMessagesFn includes them by role).
  const loadOlder = async () => {
    if (loadingOlder || messages.length === 0) return
    setLoadingOlder(true)
    try {
      const page = await listChatMessagesFn({
        data: { conversationId, before: messages[0].id },
      })
      queryClient.setQueryData(threadKey, (prev: ThreadCache | undefined) => {
        if (!prev) return prev
        const known = new Set(prev.messages.map((m) => m.id))
        const older = page.messages.filter((m) => !known.has(m.id)).map(asAgentMessage)
        return { ...prev, messages: [...older, ...prev.messages], hasMore: page.hasMore }
      })
    } catch {
      toast.error('Failed to load older messages')
    } finally {
      setLoadingOlder(false)
    }
  }

  // Newest-first view of the thread, reused by the lookups below.
  const reversedMessages = [...messages].reverse()

  // Default the convert/draft dialog to the conversation subject + the last thing the visitor said.
  const lastVisitorMessage = reversedMessages.find((m) => m.senderType === 'visitor')
  const convertDefaultTitle = conversation?.subject ?? ''
  const convertDefaultContent = lastVisitorMessage?.content ?? ''

  // The conversation DTO carries no principal type, so treat "no captured
  // contact email on file" as the anonymous-visitor signal — exactly when the
  // convert dialog should offer the optional email-capture field.
  const visitorContactEmail = conversation?.visitorEmail ?? null
  const visitorIsAnonymous = conversation != null && visitorContactEmail == null

  // The agent's latest message is "Seen" once the visitor read watermark
  // reaches it.
  const lastAgentMessage = reversedMessages.find((m) => m.senderType === 'agent')
  const lastAgentSeen =
    !!conversation?.visitorLastReadAt &&
    !!lastAgentMessage &&
    new Date(conversation.visitorLastReadAt).getTime() >=
      new Date(lastAgentMessage.createdAt).getTime()

  // Keyed on the newest id (not length) so prepending older messages doesn't
  // yank the view to the bottom. Skipped while a jump is pending so it doesn't
  // fight the scroll-to-target (the ref read avoids re-firing when it resolves).
  useEffect(() => {
    if (pendingTargetRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.at(-1)?.id, isLoading, isVisitorTyping])

  // Re-arm the jump whenever the URL target changes (e.g. clicking another
  // "Saved for later" message while this conversation is already open).
  useEffect(() => {
    setPendingTarget(targetMessageId)
    jumpPagesRef.current = 0
  }, [targetMessageId])

  // Resolve a pending jump: once the target message is loaded, scroll it to
  // center and flash it; otherwise pull older pages (capped) until it appears
  // or we run out. Giving up clears pendingTarget so normal scrolling resumes.
  useEffect(() => {
    if (!pendingTarget || isLoading) return
    if (messages.some((m) => m.id === pendingTarget)) {
      const el = scrollRef.current?.querySelector(
        `[data-message-id="${CSS.escape(pendingTarget)}"]`
      )
      el?.scrollIntoView({ block: 'center' })
      setHighlightId(pendingTarget)
      setPendingTarget(null)
      return
    }
    if (hasMoreOlder && !loadingOlder && jumpPagesRef.current < MAX_JUMP_PAGES) {
      jumpPagesRef.current += 1
      void loadOlder()
    } else if (!hasMoreOlder || jumpPagesRef.current >= MAX_JUMP_PAGES) {
      setPendingTarget(null)
    }
  }, [pendingTarget, messages, isLoading, hasMoreOlder, loadingOlder])

  // Clear the flash once it has played through.
  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => setHighlightId(null), FLASH_MS)
    return () => clearTimeout(t)
  }, [highlightId])

  // Clear the agent-side unread badge when a thread is open and new visitor
  // messages arrive — opening + reading should mark read, not only replying.
  // Keyed on the last message id so array re-creation doesn't re-fire the write.
  const lastMessageId = messages.at(-1)?.id
  useEffect(() => {
    if (isLoading || messages.length === 0) return
    if (messages.at(-1)?.senderType !== 'visitor') return
    void markChatReadFn({ data: { conversationId } })
      .then(() => onChanged())
      .catch(() => {})
  }, [conversationId, lastMessageId, isLoading, onChanged])

  // Merge a freshly-sent message into the thread cache (dedup by id).
  const appendToThread = (res: { conversation: ConversationDTO; message: ChatMessageDTO }) => {
    queryClient.setQueryData(threadKey, (prev: ThreadCache | undefined) =>
      prev && !prev.messages.some((m) => m.id === res.message.id)
        ? {
            ...prev,
            conversation: res.conversation,
            messages: [...prev.messages, asAgentMessage(res.message)],
          }
        : prev
    )
    onChanged()
  }

  const sendMutation = useMutation({
    mutationFn: (vars: { content: string; contentJson: JSONContent | null }) =>
      sendAgentMessageFn({
        data: { conversationId, content: vars.content, contentJson: vars.contentJson },
      }),
    onSuccess: (res) => {
      appendToThread(res)
    },
    onError: () => toast.error('Failed to send message'),
  })

  const noteMutation = useMutation({
    mutationFn: (vars: {
      content: string
      contentJson: JSONContent | null
      attachments?: ChatAttachment[]
    }) =>
      addChatNoteFn({
        data: {
          conversationId,
          content: vars.content,
          contentJson: vars.contentJson,
          attachments: vars.attachments,
        },
      }),
    onSuccess: (res) => {
      clearAttachments()
      appendToThread(res)
    },
    onError: () => toast.error('Failed to add note'),
  })

  // Re-fetch the thread (priority/assignee/tags live on the conversation row)
  // and the inbox after a metadata mutation handled by a child control.
  const refreshThread = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'inbox', 'thread', conversationId] })
    // The detail panel's "Previous conversations" list has its own cache key —
    // keep it fresh after a status/assignment/label change.
    void queryClient.invalidateQueries({ queryKey: ['admin', 'inbox', 'user-conversations'] })
    onChanged()
  }, [queryClient, conversationId, onChanged])

  const deleteMutation = useMutation({
    mutationFn: (messageId: ChatMessageId) => deleteChatMessageFn({ data: { messageId } }),
    onSuccess: (_r, messageId) => {
      queryClient.setQueryData(threadKey, (prev: ThreadCache | undefined) =>
        prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== messageId) } : prev
      )
    },
    onError: () => toast.error('Failed to delete message'),
  })

  // Toggle the caller's emoji reaction on a message (optimistic; the SSE
  // message_updated reconciles counts across agents).
  const reactionMutation = useMutation({
    mutationFn: (vars: { messageId: ChatMessageId; emoji: string; hasReacted: boolean }) =>
      (vars.hasReacted ? removeMessageReactionFn : addMessageReactionFn)({
        data: { messageId: vars.messageId, emoji: vars.emoji },
      }),
    onMutate: (vars) => {
      queryClient.setQueryData(threadKey, (prev: ThreadCache | undefined) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === vars.messageId
                  ? toggleReactionLocal(m, vars.emoji, vars.hasReacted, myName)
                  : m
              ),
            }
          : prev
      )
    },
    // Reconcile to the server's canonical reaction list (real reactor names +
    // authoritative counts) for just this message — no thread refetch, so loaded
    // history and scroll position are preserved.
    onSuccess: (data, vars) => {
      queryClient.setQueryData(threadKey, (prev: ThreadCache | undefined) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === vars.messageId ? { ...m, reactions: data.reactions } : m
              ),
            }
          : prev
      )
    },
    onError: () => {
      toast.error('Failed to update reaction')
      void queryClient.invalidateQueries({ queryKey: threadKey })
    },
  })

  // Toggle the caller's personal "Saved for later" flag on a message
  // (optimistic; reconciled to the server's flaggedAt; refreshes the saved feed).
  const flagMutation = useMutation({
    mutationFn: (vars: { messageId: ChatMessageId; flagged: boolean }) =>
      setMessageFlagFn({ data: { messageId: vars.messageId, flagged: vars.flagged } }),
    onMutate: (vars) => {
      queryClient.setQueryData(threadKey, (prev: ThreadCache | undefined) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === vars.messageId
                  ? {
                      ...m,
                      flaggedAt: vars.flagged ? (m.flaggedAt ?? new Date().toISOString()) : null,
                    }
                  : m
              ),
            }
          : prev
      )
    },
    onSuccess: (data, vars) => {
      queryClient.setQueryData(threadKey, (prev: ThreadCache | undefined) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === vars.messageId ? { ...m, flaggedAt: data.flaggedAt } : m
              ),
            }
          : prev
      )
      // The "Saved for later" feed changed.
      void queryClient.invalidateQueries({ queryKey: ['admin', 'inbox', 'flagged'] })
    },
    onError: () => {
      toast.error('Failed to update flag')
      void queryClient.invalidateQueries({ queryKey: threadKey })
    },
  })

  // Mark the conversation unread from a message. onChanged refreshes the inbox
  // badge; the thread stays open (the auto-read effect's deps are stable, so it
  // won't immediately re-mark read).
  const markUnreadMutation = useMutation({
    mutationFn: (messageId: ChatMessageId) =>
      markConversationUnreadFromMessageFn({ data: { conversationId, messageId } }),
    onSuccess: () => onChanged(),
    onError: () => toast.error('Failed to mark unread'),
  })

  // Saved replies for the composer picker.
  const { data: cannedData } = useQuery({
    queryKey: ['admin', 'inbox', 'canned'],
    queryFn: () => getCannedRepliesFn(),
    staleTime: 60_000,
  })
  const cannedReplies = cannedData?.cannedReplies ?? []

  const insertCanned = useCallback((body: string) => {
    replyComposerRef.current?.insertText(body)
  }, [])

  const onSend = useCallback(() => {
    if (noteMode) {
      // Notes are rich (mention chips in the doc) and can carry attachments. The
      // plain text gates the send + drives the preview; the doc carries mentions.
      const text = noteText.trim()
      if (!text || noteMutation.isPending || uploading) return
      noteMutation.mutate({
        content: text,
        contentJson: noteDocRef.current,
        attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
      })
      setNoteText('')
      noteDocRef.current = null
      setNoteResetSignal((n) => n + 1)
      return
    }
    // Reply is rich: send the plain text (preview/search) + the doc (inline
    // images/embeds). A doc with only an image/embed and no text is still valid.
    const text = replyText.trim()
    const doc = replyDocRef.current
    if ((!text && !replyDocHasContentNode(doc)) || sendMutation.isPending) return
    sendMutation.mutate({ content: text, contentJson: doc })
    setReplyText('')
    replyDocRef.current = null
    setReplyHasContentNode(false)
    setReplyResetSignal((n) => n + 1)
  }, [replyText, noteText, noteMode, noteMutation, pendingAttachments, uploading, sendMutation])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <button
              type="button"
              onClick={onBack}
              className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted md:hidden"
              aria-label="Back to conversations"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <Avatar
              src={conversation?.visitor.avatarUrl ?? null}
              name={conversation?.visitor.displayName ?? 'Visitor'}
              className="size-8 text-xs shrink-0"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {conversation?.visitor.displayName ?? 'Visitor'}
              </p>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground capitalize">
                {isOtherAgentTyping ? (
                  <span className="font-medium normal-case text-amber-600">
                    Another agent is replying…
                  </span>
                ) : (
                  conversation?.status
                )}
                {conversation && <ChannelBadge channel={conversation.channel} />}
                {conversation?.csatRating != null && (
                  <span className="ml-1.5 text-amber-500">
                    {'★'.repeat(conversation.csatRating)}
                    <span className="text-muted-foreground/50">
                      {'★'.repeat(Math.max(0, 5 - conversation.csatRating))}
                    </span>
                  </span>
                )}
              </p>
            </div>
          </div>
          {/* Convert/draft dialog has a single always-visible mount (not
              duplicated into the detail panel like the triage controls). */}
          {conversation && (
            <div className="flex shrink-0 items-center gap-1.5">
              <ConvertToPostDialog
                conversationId={conversationId}
                defaultTitle={convertDefaultTitle}
                defaultContent={convertDefaultContent}
                visitorIsAnonymous={visitorIsAnonymous}
                visitorContactEmail={visitorContactEmail}
                onConverted={refreshThread}
              />
            </div>
          )}
          {/* Per-message "Suggest as post" quick actions: one controlled dialog
              driven by either a thread message the agent picked or an AI
              "Track as post" suggestion the agent accepted from a note chip. */}
          <ConvertToPostDialog
            open={!!suggestMsg || !!suggestionSeed}
            onOpenChange={(o) => {
              if (!o) {
                setSuggestMsg(null)
                setSuggestionSeed(null)
              }
            }}
            conversationId={conversationId}
            defaultTitle={suggestionSeed?.title ?? suggestMsg?.content.trim().slice(0, 200) ?? ''}
            defaultContent={suggestionSeed?.content ?? suggestMsg?.content ?? ''}
            defaultBoardId={suggestionSeed?.boardId}
            visitorIsAnonymous={visitorIsAnonymous}
            visitorContactEmail={visitorContactEmail}
            onConverted={refreshThread}
          />
          <SharePostDialog
            open={!!shareMsg}
            onOpenChange={(o) => {
              if (!o) setShareMsg(null)
            }}
            conversationId={conversationId}
            onShared={refreshThread}
          />
          {/* Triage controls live in the detail panel at xl+; below that
              (panel hidden) they stay in the header. */}
          {conversation && (
            <div className="flex shrink-0 items-center gap-1.5 xl:hidden">
              <PriorityControl
                conversationId={conversationId}
                value={conversation.priority}
                onChanged={refreshThread}
              />
              <AssigneeControl
                conversationId={conversationId}
                assignedAgent={conversation.assignedAgent}
                onChanged={refreshThread}
              />
              <StatusControl
                conversationId={conversationId}
                status={conversation.status}
                onChanged={refreshThread}
              />
            </div>
          )}
        </div>

        {/* Conversation labels — xl+ shows them in the detail panel. */}
        {conversation && (
          <div className="flex items-center gap-1.5 border-b border-border/50 px-4 py-2 sm:px-5 xl:hidden">
            <ConversationTagsEditor conversationId={conversationId} tags={conversation.tags} />
          </div>
        )}

        {/* Messages — min-h-0 so this scrolls and the composer stays pinned. */}
        <ScrollArea className="min-h-0 flex-1" viewportRef={scrollRef}>
          <div className="flex flex-col gap-3 px-5 py-4">
            {hasMoreOlder && (
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="mx-auto rounded-full border border-border/60 px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
              >
                {loadingOlder ? 'Loading…' : 'Load earlier messages'}
              </button>
            )}
            {messages.map((m) => (
              <div key={m.id}>
                {m.id === firstUnreadId && <UnreadDivider />}
                <AdminBubble
                  message={m}
                  highlighted={m.id === highlightId}
                  onOpenPost={openPost}
                  onDelete={() => deleteMutation.mutate(m.id)}
                  onToggleReaction={(emoji, hasReacted) =>
                    reactionMutation.mutate({ messageId: m.id, emoji, hasReacted })
                  }
                  onToggleFlag={(next) => flagMutation.mutate({ messageId: m.id, flagged: next })}
                  onMarkUnread={() => markUnreadMutation.mutate(m.id)}
                  onSharePost={() => setShareMsg(m)}
                  onTrackAsPost={() => setSuggestMsg(m)}
                  onTrackSuggestion={(s) => setSuggestionSeed(s)}
                  linkPreviews={linkPreviewsEnabled}
                />
              </div>
            ))}
            {messages.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No messages yet</p>
            )}

            {lastAgentSeen && !isVisitorTyping && (
              <p className="-mt-1.5 pe-1 text-end text-[10px] text-muted-foreground/50">Seen</p>
            )}

            {isVisitorTyping && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                <TypingDots />
                <span>{conversation?.visitor.displayName ?? 'Visitor'} is typing…</span>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Composer */}
        <div className="border-t border-border/50 p-3">
          {/* Reply vs internal-note mode */}
          <div className="mb-2 flex gap-1">
            {(
              [
                { mode: false, label: 'Reply' },
                { mode: true, label: 'Note' },
              ] as const
            ).map(({ mode, label }) => (
              <button
                key={label}
                type="button"
                onClick={() => setNoteMode(mode)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  noteMode === mode
                    ? mode
                      ? 'bg-amber-400/20 text-amber-700 dark:text-amber-300'
                      : 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Attachment tray is note-only — replies put images inline instead. */}
          {noteMode && pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 pb-2">
              {pendingAttachments.map((a, i) => {
                const isImage = a.contentType?.startsWith('image/') && a.url
                return (
                  <div
                    key={i}
                    className="group relative flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-1.5 py-1 text-[11px]"
                  >
                    <PaperClipIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="max-w-[140px] truncate">{a.name || 'file'}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Remove attachment"
                    >
                      <XMarkIcon className="h-3 w-3" />
                    </button>
                    {/* Hover preview for images — a popover above the chip. */}
                    {isImage && (
                      <div className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 rounded-lg border border-border bg-popover p-1 opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
                        <img
                          src={a.url}
                          alt={a.name}
                          className="max-h-40 max-w-[220px] rounded object-contain"
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {/* Composer: the editor/textarea spans the full width on top, with the
              actions (attach / emoji / saved replies) and send on the row below.
              Enter sends; Shift+Enter inserts a newline and the textarea grows. */}
          <div
            className={cn(
              'rounded-lg border px-3 py-2 focus-within:ring-2',
              noteMode
                ? 'border-amber-400/50 bg-amber-400/5 focus-within:ring-amber-400/20'
                : 'border-border bg-background focus-within:ring-primary/20'
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files
                if (files && files.length > 0) {
                  if (noteMode) {
                    // Notes keep the attachment tray.
                    void addFiles(files)
                  } else {
                    // Replies inline the image: upload, then insert a chatImage
                    // node — matching paste/drop in the composer.
                    Array.from(files).forEach((file) => {
                      void upload(file)
                        .then((url) => replyComposerRef.current?.insertImage(url))
                        .catch(() => toast.error('Failed to upload image'))
                    })
                  }
                }
                e.target.value = ''
              }}
            />
            {noteMode ? (
              <ChatNoteEditor
                ref={noteEditorRef}
                resetSignal={noteResetSignal}
                disabled={noteMutation.isPending}
                onChange={(text, doc) => {
                  setNoteText(text)
                  noteDocRef.current = doc
                }}
                onSubmit={onSend}
                onImageFiles={(files) => void addFiles(files)}
              />
            ) : (
              <ChatRichComposer
                ref={replyComposerRef}
                resetSignal={replyResetSignal}
                disabled={sendMutation.isPending}
                placeholder="Type your reply…"
                onChange={(text, doc) => {
                  setReplyText(text)
                  replyDocRef.current = doc
                  setReplyHasContentNode(replyDocHasContentNode(doc))
                }}
                onSubmit={onSend}
                onLocalInput={onLocalInput}
                uploadImage={upload}
              />
            )}
            <div className="flex items-center gap-0.5 pt-1">
              {/* Attach is available in both reply and note mode. */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                aria-label="Attach image"
              >
                <PaperClipIcon className="h-4 w-4" />
              </button>
              <EmojiPicker
                className="size-8"
                onSelect={(emoji) => {
                  if (noteMode) noteEditorRef.current?.insertText(emoji)
                  else replyComposerRef.current?.insertText(emoji)
                }}
              />
              {!noteMode && cannedReplies.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
                      aria-label="Saved replies"
                    >
                      <ChatBubbleBottomCenterTextIcon className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 p-1">
                    <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                      Saved replies
                    </p>
                    <div className="max-h-64 overflow-y-auto">
                      {cannedReplies.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => insertCanned(c.body)}
                          className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                        >
                          <span className="font-medium">{c.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.body}
                          </span>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={onSend}
                disabled={
                  noteMode
                    ? !noteText.trim() || noteMutation.isPending
                    : (!replyText.trim() && !replyHasContentNode) || sendMutation.isPending
                }
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-md text-primary-foreground disabled:opacity-40 transition-opacity',
                  noteMode ? 'bg-amber-500 text-white' : 'bg-primary'
                )}
                aria-label={noteMode ? 'Add note' : 'Send reply'}
              >
                {noteMode ? (
                  <PencilSquareIcon className="h-4 w-4" />
                ) : (
                  <PaperAirplaneIcon className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {conversation && (
        <ConversationDetailPanel
          conversation={conversation}
          onChanged={refreshThread}
          onSelectConversation={onSelectConversation}
        />
      )}
    </div>
  )
}
