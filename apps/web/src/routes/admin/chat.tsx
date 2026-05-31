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
  TagIcon,
  CheckIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { ConversationId, ChatMessageId, TagId } from '@quackback/ids'
import {
  listConversationsFn,
  getConversationFn,
  sendAgentMessageFn,
  addChatNoteFn,
  setConversationStatusFn,
  assignConversationFn,
  setConversationTagsFn,
  markChatReadFn,
  sendChatTypingFn,
  getCannedRepliesFn,
  deleteChatMessageFn,
} from '@/lib/server/functions/chat'
import { fetchTags } from '@/lib/server/functions/tags'
import { getPortalUserFn } from '@/lib/server/functions/admin'
import type {
  ChatAttachment,
  ChatMessageDTO,
  ChatTagDTO,
  ConversationDTO,
} from '@/lib/shared/chat/types'
import { useChatStream } from '@/lib/client/hooks/use-chat-stream'
import { useChatTyping } from '@/lib/client/hooks/use-chat-typing'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import { useChatComposerAttachments } from '@/lib/client/hooks/use-chat-composer-attachments'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { TypingDots } from '@/components/shared/typing-dots'
import { ChatAttachmentList } from '@/components/shared/chat-attachments'
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
  loader: async () => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
    return {}
  },
  component: ChatInboxPage,
})

type StatusFilter = 'open' | 'snoozed' | 'closed'

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
  const [status, setStatus] = useState<StatusFilter>('open')
  const [selectedId, setSelectedId] = useState<ConversationId | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [tagFilter, setTagFilter] = useState<TagId | null>(null)
  // Debounce the search box so we don't refetch on every keystroke.
  const search = useDebouncedValue(searchInput.trim(), 300)

  // Shared tag vocabulary (also used by the thread's tag picker); cached.
  const { data: availableTags = [] } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => fetchTags(),
    staleTime: 60_000,
  })

  const listKey = useMemo(
    () => ['admin', 'chat', 'conversations', status, search, tagFilter] as const,
    [status, search, tagFilter]
  )

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: listKey,
    queryFn: () =>
      listConversationsFn({
        data: { status, search: search || undefined, tagId: tagFilter ?? undefined },
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
        // Keep the open thread's status/assignment/tags in sync with changes
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
            <h1 className="text-lg font-semibold leading-tight">Chat</h1>
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
        <div className="flex gap-1 px-3 py-2">
          {(['open', 'snoozed', 'closed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors',
                status === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {s}
            </button>
          ))}
        </div>
        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pb-2 border-b border-border/40">
            {availableTags.map((t) => {
              const active = tagFilter === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTagFilter(active ? null : t.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                    active
                      ? 'border-transparent text-white'
                      : 'border-border/60 text-muted-foreground hover:bg-muted'
                  )}
                  style={active ? { backgroundColor: t.color } : undefined}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: active ? '#fff' : t.color }}
                  />
                  {t.name}
                </button>
              )
            })}
          </div>
        )}
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
                    <span className="truncate text-sm font-medium">
                      {c.visitor.displayName ?? 'Visitor'}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {relativeTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground mt-0.5">
                    {c.lastMessagePreview ?? c.subject ?? 'No messages yet'}
                  </p>
                  {c.tags.length > 0 && <ChatTagChips tags={c.tags} className="mt-1" />}
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
}: {
  conversationId: ConversationId
  onChanged: () => void
  isVisitorTyping: boolean
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

  // The agent's latest message is "Seen" once the visitor read watermark
  // reaches it.
  const lastAgentMessage = [...messages].reverse().find((m) => m.senderType === 'agent')
  const lastAgentSeen =
    !!conversation?.visitorLastReadAt &&
    !!lastAgentMessage &&
    new Date(conversation.visitorLastReadAt).getTime() >=
      new Date(lastAgentMessage.createdAt).getTime()

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, isLoading, isVisitorTyping])

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

  const assignMutation = useMutation({
    mutationFn: () => assignConversationFn({ data: { conversationId, assignTo: 'me' } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: threadKey })
      onChanged()
    },
    onError: () => toast.error('Failed to assign conversation'),
  })

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

  // Shared tag vocabulary for the label picker (cached across inbox + thread).
  const { data: availableTags = [] } = useQuery({
    queryKey: ['admin', 'tags'],
    queryFn: () => fetchTags(),
    staleTime: 60_000,
  })

  // Reflect a tag change locally + refresh the inbox so list chips update.
  const onTagsChanged = (tags: ChatTagDTO[]) => {
    queryClient.setQueryData(
      threadKey,
      (prev: { conversation: ConversationDTO; messages: ChatMessageDTO[] } | undefined) =>
        prev ? { ...prev, conversation: { ...prev.conversation, tags } } : prev
    )
    onChanged()
  }

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
              <p className="text-[11px] text-muted-foreground capitalize">
                {conversation?.status}
                {conversation?.csatRating != null && (
                  <span className="ml-1.5 text-amber-500">
                    {'★'.repeat(conversation.csatRating)}
                    <span className="text-muted-foreground/50">
                      {'★'.repeat(Math.max(0, 5 - conversation.csatRating))}
                    </span>
                  </span>
                )}
              </p>
              {conversation && conversation.tags.length > 0 && (
                <ChatTagChips tags={conversation.tags} className="mt-1" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <TagPicker
              conversationId={conversationId}
              selected={conversation?.tags ?? []}
              available={availableTags}
              onChanged={onTagsChanged}
            />
            <ConvertToPostDialog
              conversationId={conversationId}
              defaultTitle={convertTitle}
              defaultContent={convertContent}
            />
            {!conversation?.assignedAgent && (
              <button
                type="button"
                onClick={() => assignMutation.mutate()}
                disabled={assignMutation.isPending}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Assign to me
              </button>
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

      <VisitorSidebar conversation={conversation} detail={visitorDetail} />
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

/** Read-only colored label chips. */
function ChatTagChips({ tags, className }: { tags: ChatTagDTO[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {tags.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          // 1a = ~10% alpha on the 6-digit hex, for a tinted background.
          style={{ backgroundColor: `${t.color}1a`, color: t.color }}
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} />
          {t.name}
        </span>
      ))}
    </div>
  )
}

/** Popover to toggle a conversation's labels. Each toggle persists the full set. */
function TagPicker({
  conversationId,
  selected,
  available,
  onChanged,
}: {
  conversationId: ConversationId
  selected: ChatTagDTO[]
  available: ChatTagDTO[]
  onChanged: (tags: ChatTagDTO[]) => void
}) {
  const selectedIds = new Set(selected.map((t) => t.id))
  const mutation = useMutation({
    mutationFn: (tagIds: TagId[]) => setConversationTagsFn({ data: { conversationId, tagIds } }),
    onSuccess: (dto) => onChanged(dto.tags),
    onError: () => toast.error('Failed to update tags'),
  })
  const toggle = (id: TagId) => {
    const next = selectedIds.has(id)
      ? [...selectedIds].filter((x) => x !== id)
      : [...selectedIds, id]
    mutation.mutate(next)
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          <TagIcon className="h-3.5 w-3.5" /> Tags
          {selected.length > 0 && (
            <span className="ml-0.5 rounded-full bg-muted px-1 text-[10px]">{selected.length}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {available.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No tags yet. Create tags in settings.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {available.map((t) => {
              const isOn = selectedIds.has(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id)}
                  disabled={mutation.isPending}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="flex-1 truncate">{t.name}</span>
                  {isOn && <CheckIcon className="h-3.5 w-3.5 text-primary" />}
                </button>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function VisitorSidebar({
  conversation,
  detail,
}: {
  conversation?: ConversationDTO
  detail?: Awaited<ReturnType<typeof getPortalUserFn>> | null
}) {
  if (!conversation) return null
  const name = conversation.visitor.displayName ?? 'Visitor'
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-l border-border/50 lg:flex">
      <div className="flex flex-col items-center gap-2 border-b border-border/50 px-4 py-5 text-center">
        <Avatar src={conversation.visitor.avatarUrl} name={name} className="size-12 text-base" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          {detail?.email || conversation.visitorEmail ? (
            <p className="truncate text-xs text-muted-foreground">
              {detail?.email ?? conversation.visitorEmail}
              {!detail?.email && conversation.visitorEmail && (
                <span className="ml-1 text-muted-foreground/50">(provided in chat)</span>
              )}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Anonymous visitor</p>
          )}
        </div>
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
