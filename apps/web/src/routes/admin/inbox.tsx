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
import type { ConversationId, ChatMessageId, ChatTagId } from '@quackback/ids'
import {
  listConversationsFn,
  getConversationFn,
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
  ConversationStatus,
} from '@/lib/shared/chat/types'
import { AdminBubble, UnreadDivider } from '@/components/admin/chat/admin-bubble'
import { PriorityControl } from '@/components/admin/chat/priority-control'
import { AssigneeControl } from '@/components/admin/chat/assignee-control'
import { ChannelBadge } from '@/components/admin/chat/channel-badge'
import { ConversationTagsEditor } from '@/components/admin/chat/conversation-tags-editor'
import { StatusControl } from '@/components/admin/chat/status-control'
import { ConversationDetailPanel } from '@/components/admin/chat/conversation-detail-panel'
import { ConversationListColumn } from '@/components/admin/chat/conversation-list-column'
import { SavedMessagesColumn } from '@/components/admin/chat/saved-messages-column'
import { ChatNoteEditor, type ChatNoteEditorHandle } from '@/components/admin/chat/chat-note-editor'
import {
  InboxNavSidebar,
  inboxNavKey,
  scopeLabelFor,
  useChatTagsWithCounts,
  type InboxNavItem,
  type InboxView,
} from '@/components/admin/chat/inbox-nav-sidebar'
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

/** A real conversation status, or 'all' = no status filter. */
type StatusFilter = ConversationStatus | 'all'

const PRIORITY_VALUES = ['all', 'none', 'low', 'medium', 'high', 'urgent'] as const

/** Inbox URL search params — the source of truth for the open chat + filters. */
export interface InboxSearch {
  c?: string
  view?: InboxView
  tag?: string
  status?: StatusFilter
  priority?: ConversationPriority | 'all'
  q?: string
}

export const Route = createFileRoute('/admin/inbox')({
  // `?c=<conversationId>` deep-links a conversation open (e.g. from a user
  // profile). `?view=`/`?tag=` deep-link the left-nav scope so it survives a
  // refresh and is shareable. All optional, so existing `{ c }` links still type.
  // Everything that defines the current view lives in the URL so a refresh
  // restores the exact open conversation + filters, and links are shareable.
  validateSearch: (search: Record<string, unknown>): InboxSearch => ({
    c: typeof search.c === 'string' ? search.c : undefined,
    view:
      search.view === 'mine' ||
      search.view === 'unassigned' ||
      search.view === 'all' ||
      search.view === 'mentions'
        ? search.view
        : undefined,
    // Only accept a well-formed chat-tag id — a malformed `?tag=` would reach a
    // uuid-backed query and 500 the conversation list.
    tag:
      typeof search.tag === 'string' && isValidTypeId(search.tag, 'chat_tag')
        ? search.tag
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
  }),
  loader: async () => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
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

/**
 * Map the active nav scope + filter chips to the list-query params. The primary
 * views ARE the assignee queue (Mine / Unassigned / All); Mentions is a personal
 * feed; a Label scope refines by tag. Status + priority are optional chips
 * ('all' = unset), applied within any non-Mentions scope.
 */
function buildListParams(
  nav: InboxNavItem,
  status: StatusFilter,
  priorityFilter: ConversationPriority | 'all',
  search: string
) {
  const priority = priorityFilter === 'all' ? undefined : priorityFilter
  const statusParam = status === 'all' ? undefined : status
  const q = search || undefined
  if (nav.kind === 'tag') return { tagIds: [nav.tagId], status: statusParam, priority, search: q }
  if (nav.view === 'mentions') return { view: 'mentions' as const, search: q }
  const assignee =
    nav.view === 'mine'
      ? ('mine' as const)
      : nav.view === 'unassigned'
        ? ('unassigned' as const)
        : ('all' as const)
  return { status: statusParam, priority, assignee, search: q }
}

function InboxPage() {
  const queryClient = useQueryClient()
  const navigate = Route.useNavigate()
  const {
    c: urlC,
    view: urlView,
    tag: urlTag,
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
  // feed, or a single Label. Status/priority chips refine WITHIN it; Mentions is
  // a self-contained feed so those chips are hidden.
  const nav = useMemo<InboxNavItem>(
    () =>
      urlTag
        ? { kind: 'tag', tagId: urlTag as ChatTagId }
        : { kind: 'view', view: urlView ?? 'all' },
    [urlTag, urlView]
  )
  const setNav = useCallback(
    (item: InboxNavItem) =>
      updateSearch({
        view: item.kind === 'view' ? item.view : undefined,
        tag: item.kind === 'tag' ? item.tagId : undefined,
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
  const setSelectedId = useCallback(
    (id: ConversationId | null) => updateSearch({ c: id ?? undefined }),
    [updateSearch]
  )

  // The status/priority chips apply to every scope except the Mentions feed.
  const showRefinements = nav.kind === 'tag' || nav.view !== 'mentions'
  const { data: navTags } = useChatTagsWithCounts()
  const scopeLabel = scopeLabelFor(nav, navTags)

  // Search is a live local input mirrored (debounced) into the URL `q`.
  const [searchInput, setSearchInput] = useState(urlQ ?? '')
  const search = useDebouncedValue(searchInput.trim(), 300)
  useEffect(() => {
    updateSearch({ q: search || undefined })
  }, [search, updateSearch])

  const listKey = useMemo(
    () =>
      [
        'admin',
        'inbox',
        'conversations',
        inboxNavKey(nav),
        status,
        priorityFilter,
        search,
      ] as const,
    [nav, status, priorityFilter, search]
  )

  // The "Saved for later" view shows flagged MESSAGES, not conversations, so the
  // conversation-list query is idle there.
  const isSaved = nav.kind === 'view' && nav.view === 'saved'
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: listKey,
    queryFn: () =>
      listConversationsFn({
        data: buildListParams(nav, status, priorityFilter, search),
      }),
    refetchInterval: 30_000, // polling fallback if the stream drops
    enabled: !isSaved,
  })

  const conversations = listData?.conversations ?? []

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
        // Keep the open thread's status/assignment in sync with changes
        // made by another agent.
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
        <SavedMessagesColumn selectedConversationId={selectedId} onSelect={setSelectedId} />
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

/** Grow a composer textarea to fit its content, up to a max height (px). */
const COMPOSER_MAX_HEIGHT = 128
function autoGrowTextarea(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
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

function ChatThread({
  conversationId,
  onChanged,
  onBack,
  onSelectConversation,
  isVisitorTyping,
  isOtherAgentTyping,
}: {
  conversationId: ConversationId
  onChanged: () => void
  /** Mobile-only: return to the conversation list (single-column layout). */
  onBack: () => void
  /** Open another conversation (e.g. from the detail panel's history). */
  onSelectConversation: (id: ConversationId) => void
  isVisitorTyping: boolean
  isOtherAgentTyping: boolean
}) {
  const queryClient = useQueryClient()
  const threadKey = ['admin', 'inbox', 'thread', conversationId] as const
  // The current agent's display name, for attributing optimistic reactions.
  const { session } = useRouteContext({ from: '__root__' })
  const myName = session?.user?.name ?? 'You'
  const [reply, setReply] = useState('')
  // Composer mode: a public reply to the visitor, or an internal team note.
  const [noteMode, setNoteMode] = useState(false)
  // Internal-note composer state (separate from the plain reply textarea): the
  // note is a rich TipTap doc so it can carry @-mention chips.
  const [noteText, setNoteText] = useState('')
  const noteDocRef = useRef<JSONContent | null>(null)
  const [noteResetSignal, setNoteResetSignal] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

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
  const replyComposerRef = useRef<HTMLTextAreaElement>(null)
  const noteEditorRef = useRef<ChatNoteEditorHandle>(null)

  const { data, isLoading } = useQuery({
    queryKey: threadKey,
    queryFn: () => getConversationFn({ data: { conversationId } }),
  })

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

  // The agent's latest message is "Seen" once the visitor read watermark
  // reaches it.
  const lastAgentMessage = [...messages].reverse().find((m) => m.senderType === 'agent')
  const lastAgentSeen =
    !!conversation?.visitorLastReadAt &&
    !!lastAgentMessage &&
    new Date(conversation.visitorLastReadAt).getTime() >=
      new Date(lastAgentMessage.createdAt).getTime()

  // Keyed on the newest id (not length) so prepending older messages doesn't
  // yank the view to the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.at(-1)?.id, isLoading, isVisitorTyping])

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
    mutationFn: (vars: { content: string; attachments?: ChatAttachment[] }) =>
      sendAgentMessageFn({
        data: { conversationId, content: vars.content, attachments: vars.attachments },
      }),
    onSuccess: (res) => {
      clearAttachments()
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
    setReply((r) => (r.trim() ? `${r}\n${body}` : body))
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
    const text = reply.trim()
    if ((!text && pendingAttachments.length === 0) || sendMutation.isPending || uploading) return
    setReply('')
    // Collapse the auto-grown composer back to a single row after sending.
    if (replyComposerRef.current) replyComposerRef.current.style.height = 'auto'
    sendMutation.mutate({
      content: text,
      attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
    })
  }, [reply, noteText, noteMode, noteMutation, pendingAttachments, uploading, sendMutation])

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
                  onDelete={() => deleteMutation.mutate(m.id)}
                  onToggleReaction={(emoji, hasReacted) =>
                    reactionMutation.mutate({ messageId: m.id, emoji, hasReacted })
                  }
                  onToggleFlag={(next) => flagMutation.mutate({ messageId: m.id, flagged: next })}
                  onMarkUnread={() => markUnreadMutation.mutate(m.id)}
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
          {pendingAttachments.length > 0 && (
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
                if (e.target.files) void addFiles(e.target.files)
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
              />
            ) : (
              <textarea
                ref={replyComposerRef}
                value={reply}
                onChange={(e) => {
                  setReply(e.target.value)
                  onLocalInput()
                  autoGrowTextarea(e.target)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSend()
                  }
                }}
                rows={1}
                placeholder="Type your reply…"
                className="w-full resize-none bg-transparent px-1 py-1 text-sm outline-none max-h-32"
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
                  else setReply((prev) => prev + emoji)
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
                    : (!reply.trim() && pendingAttachments.length === 0) ||
                      sendMutation.isPending ||
                      uploading
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
