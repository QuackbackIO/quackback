import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  XMarkIcon,
  CheckCircleIcon,
  ArrowUturnLeftIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  TrashIcon,
  ChatBubbleBottomCenterTextIcon,
  PencilSquareIcon,
  BoltIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { ConversationId, ChatMessageId } from '@quackback/ids'
import {
  listConversationsFn,
  getConversationFn,
  listChatMessagesFn,
  sendAgentMessageFn,
  addChatNoteFn,
  setConversationStatusFn,
  markChatReadFn,
  sendChatTypingFn,
  getCannedRepliesFn,
  getMacrosFn,
  applyMacroFn,
  deleteChatMessageFn,
} from '@/lib/server/functions/chat'
import { getPortalUserFn } from '@/lib/server/functions/admin'
import type {
  ChatAttachment,
  ChatMessageDTO,
  ConversationDTO,
  ConversationPriority,
} from '@/lib/shared/chat/types'
import { priorityMeta } from '@/lib/shared/chat/priority-meta'
import {
  PriorityControl,
  PriorityDot,
  PriorityMenuItems,
} from '@/components/admin/chat/priority-control'
import { AssigneeControl } from '@/components/admin/chat/assignee-control'
import { ConversationTags } from '@/components/admin/chat/conversation-tags'
import { ConversationWatchers } from '@/components/admin/chat/conversation-watchers'
import { LinkedPosts } from '@/components/admin/chat/linked-posts'
import { ChannelBadge, NoEmailBadge } from '@/components/admin/chat/channel-badge'
import { TagChip } from '@/components/shared/tag-chip'
import { useChatStream } from '@/lib/client/hooks/use-chat-stream'
import { useChatTyping } from '@/lib/client/hooks/use-chat-typing'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import { useChatComposerAttachments } from '@/lib/client/hooks/use-chat-composer-attachments'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { TypingDots } from '@/components/shared/typing-dots'
import { ChatAttachmentList } from '@/components/shared/chat-attachments'
import { EmojiPicker } from '@/components/shared/emoji-picker'
import { ConvertToPostDialog } from '@/components/admin/chat/convert-to-post-dialog'
import { Avatar } from '@/components/ui/avatar'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/shared/utils'

export const Route = createFileRoute('/admin/chat')({
  // `?c=<conversationId>` deep-links a conversation open (e.g. from a user profile).
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search.c === 'string' ? search.c : undefined,
  }),
  loader: async () => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
    return {}
  },
  component: ChatInboxPage,
})

type StatusFilter = 'open' | 'snoozed' | 'pending' | 'closed'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function ChatInboxPage() {
  const queryClient = useQueryClient()
  const { c: deepLinkConversationId } = Route.useSearch()
  const [status, setStatus] = useState<StatusFilter>('open')
  const [priorityFilter, setPriorityFilter] = useState<ConversationPriority | 'all'>('all')
  const [selectedId, setSelectedId] = useState<ConversationId | null>(
    (deepLinkConversationId as ConversationId | undefined) ?? null
  )
  const [searchInput, setSearchInput] = useState('')
  // Debounce the search box so we don't refetch on every keystroke.
  const search = useDebouncedValue(searchInput.trim(), 300)

  const listKey = useMemo(
    () => ['admin', 'chat', 'conversations', status, priorityFilter, search] as const,
    [status, priorityFilter, search]
  )

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: listKey,
    queryFn: () =>
      listConversationsFn({
        data: {
          status,
          priority: priorityFilter === 'all' ? undefined : priorityFilter,
          search: search || undefined,
        },
      }),
    refetchInterval: 30_000, // polling fallback if the stream drops
  })

  const conversations = listData?.conversations ?? []

  // Live updates for the whole inbox over one cookie-authenticated stream.
  const refreshInbox = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'chat', 'conversations'] })
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
      // 'read' / 'typing' don't change inbox ordering or counts, so only refetch
      // the list on message/conversation events.
      if (evt.kind !== 'read' && evt.kind !== 'typing') refreshInbox()

      if (evt.kind === 'message' && evt.conversationId === selectedId) {
        if (evt.message.senderType === 'visitor') clearRemoteTyping()
        if (evt.message.senderType === 'agent') clearOtherAgentTyping()
        queryClient.setQueryData(
          ['admin', 'chat', 'thread', selectedId],
          (prev: { conversation: ConversationDTO; messages: ChatMessageDTO[] } | undefined) => {
            if (!prev) return prev
            if (prev.messages.some((m) => m.id === evt.message.id)) return prev
            return { ...prev, messages: [...prev.messages, evt.message] }
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
      } else if (
        evt.kind === 'read' &&
        evt.conversationId === selectedId &&
        evt.side === 'visitor'
      ) {
        // Advance the visitor read watermark so the agent's "Seen" updates live.
        queryClient.setQueryData(
          ['admin', 'chat', 'thread', selectedId],
          (prev: { conversation: ConversationDTO; messages: ChatMessageDTO[] } | undefined) =>
            prev
              ? { ...prev, conversation: { ...prev.conversation, visitorLastReadAt: evt.at } }
              : prev
        )
      } else if (evt.kind === 'message_deleted' && evt.conversationId === selectedId) {
        queryClient.setQueryData(
          ['admin', 'chat', 'thread', selectedId],
          (prev: { conversation: ConversationDTO; messages: ChatMessageDTO[] } | undefined) =>
            prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== evt.messageId) } : prev
        )
      } else if (evt.kind === 'conversation' && evt.conversation.id === selectedId) {
        // Keep the open thread's status/assignment in sync with changes
        // made by another agent.
        queryClient.setQueryData(
          ['admin', 'chat', 'thread', selectedId],
          (prev: { conversation: ConversationDTO; messages: ChatMessageDTO[] } | undefined) =>
            prev ? { ...prev, conversation: evt.conversation } : prev
        )
      }
    },
  })

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="flex w-80 shrink-0 flex-col border-r border-border/50">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border/50">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <ChatBubbleLeftRightIcon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Support</h1>
            <p className="text-xs text-muted-foreground">Live conversations</p>
          </div>
        </div>
        <div className="px-3 pt-2">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search conversations…"
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-1 px-3 py-2">
          {(['open', 'snoozed', 'pending', 'closed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors',
                status === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {s}
            </button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Filter by priority"
                className={cn(
                  'ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
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
              <DropdownMenuItem onClick={() => setPriorityFilter('all')} className="text-xs">
                All priorities
              </DropdownMenuItem>
              <PriorityMenuItems
                selected={priorityFilter === 'all' ? undefined : priorityFilter}
                onSelect={setPriorityFilter}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex-1 overflow-y-auto">
          {listLoading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No {status} conversations
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  'flex w-full items-start gap-2.5 px-3 py-3 text-left border-b border-border/30 transition-colors',
                  selectedId === c.id ? 'bg-muted/60' : 'hover:bg-muted/30'
                )}
              >
                <Avatar
                  src={c.visitor.avatarUrl}
                  name={c.visitor.displayName ?? 'Visitor'}
                  className="size-8 text-xs shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <PriorityDot priority={c.priority} />
                      <span className="truncate text-sm font-medium">
                        {c.visitor.displayName ?? 'Visitor'}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {relativeTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground mt-0.5">
                    {c.lastMessagePreview ?? c.subject ?? 'No messages yet'}
                  </p>
                  {(c.channel !== 'live_chat' || c.tags.length > 0) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <ChannelBadge channel={c.channel} />
                      {c.tags.slice(0, 2).map((tag) => (
                        <TagChip
                          key={tag.id}
                          name={tag.name}
                          color={tag.color}
                          className="max-w-24"
                        />
                      ))}
                      {c.tags.length > 2 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{c.tags.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {c.unreadCount > 0 && (
                  <span className="shrink-0 mt-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {c.unreadCount}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 min-w-0">
        {selectedId ? (
          <ChatThread
            key={selectedId}
            conversationId={selectedId}
            onChanged={refreshInbox}
            isVisitorTyping={visitorTyping}
            isOtherAgentTyping={otherAgentTyping}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
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

function ChatThread({
  conversationId,
  onChanged,
  isVisitorTyping,
  isOtherAgentTyping,
}: {
  conversationId: ConversationId
  onChanged: () => void
  isVisitorTyping: boolean
  isOtherAgentTyping: boolean
}) {
  const queryClient = useQueryClient()
  const threadKey = ['admin', 'chat', 'thread', conversationId] as const
  const [reply, setReply] = useState('')
  // Composer mode: a public reply to the visitor, or an internal team note.
  const [noteMode, setNoteMode] = useState(false)
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

  const { data, isLoading } = useQuery({
    queryKey: threadKey,
    queryFn: () => getConversationFn({ data: { conversationId } }),
  })

  const messages = data?.messages ?? []
  const conversation = data?.conversation
  const hasMoreOlder = data?.hasMore ?? false
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
      queryClient.setQueryData(
        threadKey,
        (
          prev:
            | { conversation: ConversationDTO; messages: ChatMessageDTO[]; hasMore: boolean }
            | undefined
        ) => {
          if (!prev) return prev
          const known = new Set(prev.messages.map((m) => m.id))
          const older = page.messages.filter((m) => !known.has(m.id))
          return { ...prev, messages: [...older, ...prev.messages], hasMore: page.hasMore }
        }
      )
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
    queryClient.setQueryData(
      threadKey,
      (prev: { conversation: ConversationDTO; messages: ChatMessageDTO[] } | undefined) =>
        prev && !prev.messages.some((m) => m.id === res.message.id)
          ? { ...prev, conversation: res.conversation, messages: [...prev.messages, res.message] }
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
    mutationFn: (content: string) => addChatNoteFn({ data: { conversationId, content } }),
    onSuccess: appendToThread,
    onError: () => toast.error('Failed to add note'),
  })

  const statusMutation = useMutation({
    mutationFn: (next: 'open' | 'snoozed' | 'closed') =>
      setConversationStatusFn({ data: { conversationId, status: next } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: threadKey })
      onChanged()
    },
    onError: () => toast.error('Failed to update conversation'),
  })

  // Re-fetch the thread (priority/assignee/tags live on the conversation row)
  // and the inbox after a metadata mutation handled by a child control.
  const refreshThread = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'chat', 'thread', conversationId] })
    onChanged()
  }, [queryClient, conversationId, onChanged])

  const deleteMutation = useMutation({
    mutationFn: (messageId: ChatMessageId) => deleteChatMessageFn({ data: { messageId } }),
    onSuccess: (_r, messageId) => {
      queryClient.setQueryData(
        threadKey,
        (prev: { conversation: ConversationDTO; messages: ChatMessageDTO[] } | undefined) =>
          prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== messageId) } : prev
      )
    },
    onError: () => toast.error('Failed to delete message'),
  })

  // Saved replies for the composer picker.
  const { data: cannedData } = useQuery({
    queryKey: ['admin', 'chat', 'canned'],
    queryFn: () => getCannedRepliesFn(),
    staleTime: 60_000,
  })
  const cannedReplies = cannedData?.cannedReplies ?? []

  // Macros: one-click action bundles applied to the open conversation.
  const { data: macrosData } = useQuery({
    queryKey: ['admin', 'chat', 'macros'],
    queryFn: () => getMacrosFn(),
    staleTime: 60_000,
  })
  const macros = macrosData?.macros ?? []
  const macroMutation = useMutation({
    mutationFn: (macroId: string) => applyMacroFn({ data: { conversationId, macroId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: threadKey })
      onChanged()
      toast.success('Macro applied')
    },
    onError: () => toast.error('Failed to apply macro'),
  })

  // Visitor context (email + past feedback); null for anonymous visitors.
  const visitorPrincipalId = conversation?.visitor.principalId
  const { data: visitorDetail } = useQuery({
    queryKey: ['admin', 'chat', 'visitor', visitorPrincipalId],
    queryFn: () => getPortalUserFn({ data: { principalId: visitorPrincipalId! } }),
    enabled: !!visitorPrincipalId,
    staleTime: 60_000,
  })

  const insertCanned = useCallback((body: string) => {
    setReply((r) => (r.trim() ? `${r}\n${body}` : body))
  }, [])

  // Seed the "create post" draft from the conversation transcript.
  const firstVisitorMessage = messages.find((m) => m.senderType === 'visitor')?.content
  const convertTitle = (conversation?.subject || firstVisitorMessage || '').slice(0, 200)
  const convertContent = messages
    .filter((m) => m.senderType === 'visitor' && m.content)
    .map((m) => m.content)
    .join('\n\n')

  const onSend = useCallback(() => {
    const text = reply.trim()
    if (noteMode) {
      // Notes are text-only; no attachments.
      if (!text || noteMutation.isPending) return
      setReply('')
      noteMutation.mutate(text)
      return
    }
    if ((!text && pendingAttachments.length === 0) || sendMutation.isPending || uploading) return
    setReply('')
    sendMutation.mutate({
      content: text,
      attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
    })
  }, [reply, noteMode, noteMutation, pendingAttachments, uploading, sendMutation])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const isClosed = conversation?.status === 'closed'

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
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
          <div className="flex items-center gap-1.5">
            <ConvertToPostDialog
              conversationId={conversationId}
              defaultTitle={convertTitle}
              defaultContent={convertContent}
            />
            {conversation && (
              <>
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
              </>
            )}
            {!isClosed && (
              <button
                type="button"
                onClick={() => statusMutation.mutate('snoozed')}
                disabled={statusMutation.isPending}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                <ClockIcon className="h-3.5 w-3.5" /> Snooze
              </button>
            )}
            <button
              type="button"
              onClick={() => statusMutation.mutate(isClosed ? 'open' : 'closed')}
              disabled={statusMutation.isPending}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              {isClosed ? (
                <>
                  <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Reopen
                </>
              ) : (
                <>
                  <CheckCircleIcon className="h-3.5 w-3.5" /> Close
                </>
              )}
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-3">
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
              <AdminBubble key={m.id} message={m} onDelete={() => deleteMutation.mutate(m.id)} />
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
        </div>

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
          {!noteMode && pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 pb-2">
              {pendingAttachments.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-1.5 py-1 text-[11px]"
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
                </div>
              ))}
            </div>
          )}
          <div
            className={cn(
              'flex items-end gap-2 rounded-lg border px-3 py-2 focus-within:ring-2',
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
            {!noteMode && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                aria-label="Attach image"
              >
                <PaperClipIcon className="h-4 w-4" />
              </button>
            )}
            <EmojiPicker onSelect={(emoji) => setReply((prev) => prev + emoji)} />
            {cannedReplies.length > 0 && (
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
            {macros.length > 0 && !noteMode && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={macroMutation.isPending}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                    aria-label="Apply a macro"
                  >
                    <BoltIcon className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-1">
                  <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">Macros</p>
                  <div className="max-h-64 overflow-y-auto">
                    {macros.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => macroMutation.mutate(m.id)}
                        className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <textarea
              value={reply}
              onChange={(e) => {
                setReply(e.target.value)
                // Typing indicators are for visitor-facing replies only.
                if (!noteMode) onLocalInput()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onSend()
                }
              }}
              rows={1}
              placeholder={noteMode ? 'Add an internal note for your team…' : 'Type your reply…'}
              className="flex-1 resize-none bg-transparent text-sm outline-none max-h-32 py-1"
            />
            <button
              type="button"
              onClick={onSend}
              disabled={
                noteMode
                  ? !reply.trim() || noteMutation.isPending
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

      <VisitorSidebar
        conversation={conversation}
        detail={visitorDetail}
        onChanged={refreshThread}
      />
    </div>
  )
}

function AdminBubble({ message, onDelete }: { message: ChatMessageDTO; onDelete: () => void }) {
  // Internal notes are agent-only and never sent to the visitor — render them
  // as a distinct full-width note rather than a chat bubble.
  if (message.isInternal) {
    return (
      <div className="group relative rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <PencilSquareIcon className="h-3 w-3" />
          {message.author.displayName ?? 'Teammate'} · Internal note
        </div>
        <p className="whitespace-pre-wrap break-words text-foreground/90">{message.content}</p>
        <span className="mt-0.5 block text-[10px] text-muted-foreground/50">
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-amber-400/20 group-hover:opacity-100"
          aria-label="Delete note"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  // The agent is "me": agent messages right-aligned, visitor messages left.
  const isAgent = message.senderType === 'agent'
  return (
    <div className={cn('group flex items-end gap-2', isAgent ? 'flex-row-reverse' : 'flex-row')}>
      {!isAgent && (
        <Avatar
          src={message.author.avatarUrl}
          name={message.author.displayName ?? 'Visitor'}
          className="size-6 text-[10px] shrink-0"
        />
      )}
      <div className={cn('flex max-w-[70%] flex-col', isAgent ? 'items-end' : 'items-start')}>
        {message.content && (
          <div
            className={cn(
              'rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words',
              isAgent
                ? 'bg-primary text-primary-foreground rounded-br-md'
                : 'bg-muted text-foreground rounded-bl-md'
            )}
          >
            {message.content}
          </div>
        )}
        {message.attachments.length > 0 && <ChatAttachmentList attachments={message.attachments} />}
        <span className="mt-0.5 px-1 text-[10px] text-muted-foreground/50">
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="mb-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
            aria-label="Message actions"
          >
            <EllipsisVerticalIcon className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={isAgent ? 'end' : 'start'}>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <TrashIcon className="h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function VisitorSidebar({
  conversation,
  detail,
  onChanged,
}: {
  conversation?: ConversationDTO
  detail?: Awaited<ReturnType<typeof getPortalUserFn>> | null
  onChanged?: () => void
}) {
  if (!conversation) return null
  const name = conversation.visitor.displayName ?? 'Visitor'
  // Anonymous visitor with no captured email: an offline email reply can't reach them.
  const hasEmail = Boolean(detail?.email || conversation.visitorEmail)
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-l border-border/50 lg:flex">
      <div className="flex flex-col items-center gap-2 border-b border-border/50 px-4 py-5 text-center">
        <Avatar src={conversation.visitor.avatarUrl} name={name} className="size-12 text-base" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          {hasEmail ? (
            <p className="truncate text-xs text-muted-foreground">
              {detail?.email ?? conversation.visitorEmail}
              {!detail?.email && conversation.visitorEmail && (
                <span className="ml-1 text-muted-foreground/50">(provided in chat)</span>
              )}
            </p>
          ) : (
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              Anonymous visitor <NoEmailBadge />
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 border-b border-border/50 px-4 py-3">
        <ConversationTags
          conversationId={conversation.id}
          tags={conversation.tags}
          onChanged={onChanged}
        />
        <ConversationWatchers conversationId={conversation.id} />
        <LinkedPosts conversationId={conversation.id} />
      </div>
      {detail && (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-4 grid grid-cols-3 gap-1 text-center">
            {[
              { label: 'Posts', value: detail.postCount },
              { label: 'Comments', value: detail.commentCount },
              { label: 'Votes', value: detail.voteCount },
            ].map((s) => (
              <div key={s.label} className="rounded-md bg-muted/40 py-1.5">
                <p className="text-sm font-semibold">{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          {detail.engagedPosts.length > 0 && (
            <>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                Recent feedback
              </p>
              <div className="flex flex-col gap-1">
                {detail.engagedPosts.slice(0, 5).map((p) => (
                  <span key={p.id} className="truncate text-xs text-foreground/80">
                    {p.title}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  )
}
