/**
 * The agent-facing conversation thread (moved out of routes/admin/inbox.tsx):
 * virtualized message list with unread divider + deep-link jump, the reply /
 * internal-note composer, per-message actions (reactions, flags, delete,
 * track-as-feedback), triage controls, and the detail panel. Built on the
 * shared thread core (thread.tsx) + AgentMessageBubble + the events reducer; the
 * route keeps the list/nav chrome and the inbox SSE wiring.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import {
  PaperAirplaneIcon,
  PaperClipIcon,
  ChatBubbleBottomCenterTextIcon,
  PencilSquareIcon,
  ChevronLeftIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { ConversationId, ConversationMessageId } from '@quackback/ids'
import {
  sendAgentMessageFn,
  addConversationNoteFn,
  getCannedRepliesFn,
  deleteConversationMessageFn,
  addMessageReactionFn,
  removeMessageReactionFn,
  setMessageFlagFn,
  markConversationUnreadFromMessageFn,
} from '@/lib/server/functions/conversation'
import type {
  ConversationAttachment,
  ConversationMessageDTO,
  AgentConversationMessageDTO,
  ConversationDTO,
} from '@/lib/shared/conversation/types'
import { AgentMessageBubble, UnreadDivider } from '@/components/conversation/message-bubble'
import {
  ThreadViewport,
  useComposerDoc,
  useMarkReadOnIncoming,
  useOlderMessages,
  useThreadVirtualizer,
  useTypingSender,
  docHasContentNode,
} from '@/components/conversation/thread'
import {
  appendSentAgentMessage,
  prependOlderAgentMessages,
  removeAgentThreadMessage,
  toggleReactionLocal,
  updateAgentThreadMessage,
  type AgentThreadCache,
} from '@/components/conversation/events-reducer'
import { conversationKeys } from '@/components/conversation/query-keys'
import { PriorityControl } from '@/components/admin/conversation/priority-control'
import { AssigneeControl } from '@/components/admin/conversation/assignee-control'
import { ChannelBadge } from '@/components/admin/conversation/channel-badge'
import { ConversationTagsEditor } from '@/components/admin/conversation/conversation-tags-editor'
import { StatusControl } from '@/components/admin/conversation/status-control'
import { ConversationDetailPanel } from '@/components/admin/conversation/conversation-detail-panel'
import { ConvertToPostDialog } from '@/components/admin/conversation/convert-to-post-dialog'
import { EndConversationDialog } from '@/components/admin/conversation/end-conversation-dialog'
import { SharePostDialog } from '@/components/admin/conversation/share-post-dialog'
import {
  ConversationNoteEditor,
  type ConversationNoteEditorHandle,
} from '@/components/admin/conversation/conversation-note-editor'
import { ComposerAttachmentTray } from '@/components/shared/composer-attachment-tray'
import { LinkPreviews } from '@/components/shared/link-preview-card'
import {
  ConversationRichComposer,
  type ConversationRichComposerHandle,
} from '@/components/admin/conversation/conversation-rich-composer'
import { conversationInboxQueries } from '@/lib/client/queries/conversation-inbox'
import {
  buildAdminConversationRows,
  type AdminConversationRow,
} from '@/lib/client/conversation/admin-conversation-rows'
import type { JSONContent } from '@tiptap/core'
import { useConversationTyping } from '@/lib/client/hooks/use-conversation-typing'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import { useConversationComposerAttachments } from '@/lib/client/hooks/use-conversation-composer-attachments'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { TypingDots } from '@/components/shared/typing-dots'
import { EmojiPicker } from '@/components/shared/emoji-picker'
import { Avatar } from '@/components/ui/avatar'
import { Spinner } from '@/components/shared/spinner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/shared/types/settings'

// "Jump to message" tuning: how long the flash plays (must match the
// flash-highlight keyframe duration) and how many older pages we'll auto-pull
// chasing a deep-linked message before giving up.
const FLASH_MS = 2200
const MAX_JUMP_PAGES = 20

export function AgentConversationThread({
  conversationId,
  targetMessageId,
  onChanged,
  onBack,
  onSelectConversation,
  onOpenPost,
  isVisitorTyping,
  isOtherAgentTyping,
}: {
  conversationId: ConversationId
  /** Deep-link target: scroll to + flash this message once it's loaded. */
  targetMessageId: ConversationMessageId | null
  onChanged: () => void
  /** Mobile-only: return to the conversation list (single-column layout). */
  onBack: () => void
  /** Open another conversation (e.g. from the detail panel's history). */
  onSelectConversation: (id: ConversationId) => void
  /** Open an embedded post in the host's in-place `?post=` modal (the route owns
   *  the search-param navigation so the agent never leaves the conversation). */
  onOpenPost: (postId: string) => void
  isVisitorTyping: boolean
  isOtherAgentTyping: boolean
}) {
  const queryClient = useQueryClient()
  const threadKey = conversationKeys.agentThread(conversationId)
  // The current agent's display name, for attributing optimistic reactions.
  const { session, settings } = useRouteContext({ from: '__root__' })
  const myName = session?.user?.name ?? 'You'
  const linkPreviewsEnabled =
    (settings?.featureFlags as FeatureFlags | undefined)?.linkPreviews ?? false

  // Reply composer is a rich TipTap doc (inline images + post embeds); the note
  // composer is a separate rich doc so it can carry @-mention chips. Composer
  // mode toggles which one is live.
  const reply = useComposerDoc()
  const note = useComposerDoc()
  const [noteMode, setNoteMode] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Live link-unfurl in the composer (the "preview tray"), debounced so it fires
  // on a settled URL rather than every keystroke.
  const debouncedComposerText = useDebouncedValue(noteMode ? note.text : reply.text, 500)

  // The one controlled convert dialog's seed, built at whichever entry point
  // opened it: a per-message "Track as feedback" pick, an AI "Track as post"
  // suggestion accepted from a note chip (carries a board), or the
  // conversation-level button in the detail panel. Null = dialog closed.
  const [convertSeed, setConvertSeed] = useState<{
    title: string
    content: string
    boardId?: string
  } | null>(null)
  // The message driving the share-post picker.
  const [shareMsg, setShareMsg] = useState<AgentConversationMessageDTO | null>(null)
  // The end-conversation reason dialog (opened from the detail panel).
  const [endDialogOpen, setEndDialogOpen] = useState(false)

  // "Jump to message" deep-link state. pendingTarget is the message we still
  // need to scroll to (null once resolved); highlightId is the one currently
  // flashing. pendingTargetRef mirrors pendingTarget so the auto-scroll-to-
  // bottom effect can read it without listing it as a dep (which would re-fire
  // a bottom-scroll the instant the jump resolves).
  const [pendingTarget, setPendingTarget] = useState<ConversationMessageId | null>(targetMessageId)
  const [highlightId, setHighlightId] = useState<ConversationMessageId | null>(null)
  const pendingTargetRef = useRef<ConversationMessageId | null>(targetMessageId)
  pendingTargetRef.current = pendingTarget
  const jumpPagesRef = useRef(0)

  const sendTyping = useTypingSender(conversationId)
  const { onLocalInput } = useConversationTyping(sendTyping)

  const { upload } = useImageUpload({ endpoint: '/api/upload/image', prefix: 'chat-images' })
  const {
    pending: pendingAttachments,
    addFiles,
    remove: removeAttachment,
    clear: clearAttachments,
    uploading,
  } = useConversationComposerAttachments(upload)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replyComposerRef = useRef<ConversationRichComposerHandle>(null)
  const noteEditorRef = useRef<ConversationNoteEditorHandle>(null)

  // Shared factory (same key as `threadKey`) so a `?c=` deep-link prefetched by
  // the route loader hydrates this thread on first paint.
  const { data, isLoading } = useQuery(conversationInboxQueries.thread(conversationId))

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

  // Prepend an older page (keyset cursor = oldest loaded message id). Agents see
  // internal notes here too (listConversationMessagesFn includes them by role).
  const { loadingOlder, loadOlder } = useOlderMessages({
    conversationId,
    messages,
    onPage: (page) =>
      queryClient.setQueryData(threadKey, (prev: AgentThreadCache | undefined) =>
        prependOlderAgentMessages(prev, page)
      ),
    onError: () => toast.error('Failed to load older messages'),
  })

  // Default the convert/draft dialog to the conversation subject + the last thing the visitor said.
  const lastVisitorMessage = messages.findLast((m) => m.senderType === 'visitor')
  const convertDefaultTitle = conversation?.subject ?? ''
  const convertDefaultContent = lastVisitorMessage?.content ?? ''
  // Conversation-level "Track as feedback" seeds from the FIRST visitor message
  // (the original ask) rather than the latest one — that's the request worth
  // capturing as a post. Title falls back to a preview of it when there's no
  // subject.
  const firstVisitorMessage = messages.find((m) => m.senderType === 'visitor')
  const trackConvoTitle =
    conversation?.subject ?? firstVisitorMessage?.content.trim().slice(0, 200) ?? ''
  const trackConvoContent = firstVisitorMessage?.content ?? ''

  // The conversation DTO carries no principal type, so treat "no captured
  // contact email on file" as the anonymous-visitor signal — exactly when the
  // convert dialog should offer the optional email-capture field.
  const visitorContactEmail = conversation?.visitorEmail ?? null
  const visitorIsAnonymous = conversation != null && visitorContactEmail == null

  // The agent's latest message is "Seen" once the visitor read watermark
  // reaches it.
  const lastAgentMessage = messages.findLast((m) => m.senderType === 'agent')
  const lastAgentSeen =
    !!conversation?.visitorLastReadAt &&
    !!lastAgentMessage &&
    new Date(conversation.visitorLastReadAt).getTime() >=
      new Date(lastAgentMessage.createdAt).getTime()

  // Flatten the thread into virtualized rows (load-older → messages w/ unread
  // divider → empty → seen → typing). anchorTo:'end' + followOnAppend keep the
  // view pinned to the newest message and stick to the bottom as messages stream
  // in; getItemKey (message id) lets the virtualizer hold the viewport when older
  // history is prepended, and measureElement re-pins after late-loading images
  // grow a row (replacing the old one-shot scroll + ResizeObserver pinning).
  const rows = useMemo(
    () =>
      buildAdminConversationRows({
        messages,
        hasMoreOlder,
        firstUnreadId,
        showSeen: lastAgentSeen && !isVisitorTyping,
        showTyping: isVisitorTyping,
      }),
    [messages, hasMoreOlder, firstUnreadId, lastAgentSeen, isVisitorTyping]
  )

  // A pending `?m=` jump owns the initial scroll, so consume the one-shot
  // without scrolling to the bottom in that case.
  const virtualizer = useThreadVirtualizer({
    rows,
    scrollRef,
    estimateSize: 72,
    loading: isLoading,
    skipInitialScroll: () => pendingTargetRef.current != null,
  })

  // After our own send, jump to the freshly-appended message — followOnAppend
  // only auto-follows when already at the bottom, so an agent who replied while
  // scrolled up still lands on their message. Deferred to a layout effect so the
  // new row exists in `rows` before we scroll (onSuccess appends it this tick,
  // when rows.length is still stale).
  const pendingOwnSendScroll = useRef(false)
  useLayoutEffect(() => {
    if (!pendingOwnSendScroll.current || rows.length === 0) return
    pendingOwnSendScroll.current = false
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
  }, [rows.length, virtualizer])

  // Scroll-to-bottom pill state. `atEnd` reads the live virtualizer offset, which
  // lags one frame behind a programmatic/follow scroll — so to flag "new messages
  // below" we compare against the PREVIOUS render's at-end state (wasAtEndRef),
  // not the live value (which momentarily reads false right after any append).
  const lastMessageId = messages.at(-1)?.id
  const atEnd = virtualizer.isAtEnd()
  const [hasNewBelow, setHasNewBelow] = useState(false)
  const wasAtEndRef = useRef(true)
  const prevLastIdRef = useRef(lastMessageId)
  // Surface the "new messages" pill when a message lands while the agent was
  // scrolled up. Declared BEFORE the at-end effect on purpose: React runs effects
  // in declaration order, so this reads wasAtEndRef while it still holds the
  // PREVIOUS render's value (before the at-end effect overwrites it) — which keeps
  // the pill from flashing when followOnAppend re-pins us on a received message.
  useEffect(() => {
    if (lastMessageId && lastMessageId !== prevLastIdRef.current && !wasAtEndRef.current) {
      setHasNewBelow(true)
    }
    prevLastIdRef.current = lastMessageId
  }, [lastMessageId])
  useEffect(() => {
    if (atEnd) setHasNewBelow(false)
    wasAtEndRef.current = atEnd
  }, [atEnd])

  // Re-arm the jump whenever the URL target changes (e.g. clicking another
  // "Saved for later" message while this conversation is already open).
  useEffect(() => {
    setPendingTarget(targetMessageId)
    jumpPagesRef.current = 0
  }, [targetMessageId])

  // Resolve a pending jump: once the target message is loaded, center it via the
  // virtualizer and flash it (scrollToIndex self-corrects as off-screen rows are
  // measured); otherwise pull older pages (capped) until it appears or we run
  // out. Giving up clears pendingTarget so normal scrolling resumes.
  useEffect(() => {
    if (!pendingTarget || isLoading) return
    const index = rows.findIndex((r) => r.type === 'message' && r.message.id === pendingTarget)
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: 'center' })
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
  }, [pendingTarget, rows, isLoading, hasMoreOlder, loadingOlder, virtualizer])

  // Clear the flash once it has played through.
  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => setHighlightId(null), FLASH_MS)
    return () => clearTimeout(t)
  }, [highlightId])

  // Clear the agent-side unread badge when a thread is open and new visitor
  // messages arrive — opening + reading should mark read, not only replying.
  useMarkReadOnIncoming({
    conversationId,
    messages,
    whenLastFrom: 'visitor',
    enabled: !isLoading,
    onMarked: onChanged,
  })

  // Merge a freshly-sent message into the thread cache (dedup by id).
  const appendToThread = (res: {
    conversation: ConversationDTO
    message: ConversationMessageDTO
  }) => {
    queryClient.setQueryData(threadKey, (prev: AgentThreadCache | undefined) =>
      appendSentAgentMessage(prev, res)
    )
    onChanged()
  }

  const sendMutation = useMutation({
    mutationFn: (vars: {
      content: string
      contentJson: JSONContent | null
      attachments?: ConversationAttachment[]
    }) =>
      sendAgentMessageFn({
        data: {
          conversationId,
          content: vars.content,
          contentJson: vars.contentJson,
          attachments: vars.attachments,
        },
      }),
    onSuccess: (res) => {
      clearAttachments()
      // Our own send always lands at the bottom (followOnAppend only follows
      // when already at end); the layout effect scrolls once the row exists.
      pendingOwnSendScroll.current = true
      appendToThread(res)
    },
    onError: () => toast.error('Failed to send message'),
  })

  const noteMutation = useMutation({
    mutationFn: (vars: {
      content: string
      contentJson: JSONContent | null
      attachments?: ConversationAttachment[]
    }) =>
      addConversationNoteFn({
        data: {
          conversationId,
          content: vars.content,
          contentJson: vars.contentJson,
          attachments: vars.attachments,
        },
      }),
    onSuccess: (res) => {
      clearAttachments()
      pendingOwnSendScroll.current = true
      appendToThread(res)
    },
    onError: () => toast.error('Failed to add note'),
  })

  // Re-fetch the thread (priority/assignee/tags live on the conversation row)
  // and the inbox after a metadata mutation handled by a child control.
  const refreshThread = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: conversationKeys.agentThread(conversationId) })
    // The detail panel's "Previous conversations" list has its own cache key —
    // keep it fresh after a status/assignment/label change.
    void queryClient.invalidateQueries({ queryKey: conversationKeys.agentUserConversations() })
    onChanged()
  }, [queryClient, conversationId, onChanged])

  const deleteMutation = useMutation({
    mutationFn: (messageId: ConversationMessageId) =>
      deleteConversationMessageFn({ data: { messageId } }),
    onSuccess: (_r, messageId) => {
      queryClient.setQueryData(threadKey, (prev: AgentThreadCache | undefined) =>
        removeAgentThreadMessage(prev, messageId)
      )
    },
    onError: () => toast.error('Failed to delete message'),
  })

  // Toggle the caller's emoji reaction on a message (optimistic; the SSE
  // message_updated reconciles counts across agents).
  const reactionMutation = useMutation({
    mutationFn: (vars: { messageId: ConversationMessageId; emoji: string; hasReacted: boolean }) =>
      (vars.hasReacted ? removeMessageReactionFn : addMessageReactionFn)({
        data: { messageId: vars.messageId, emoji: vars.emoji },
      }),
    onMutate: (vars) => {
      queryClient.setQueryData(threadKey, (prev: AgentThreadCache | undefined) =>
        updateAgentThreadMessage(prev, vars.messageId, (m) =>
          toggleReactionLocal(m, vars.emoji, vars.hasReacted, myName)
        )
      )
    },
    // Reconcile to the server's canonical reaction list (real reactor names +
    // authoritative counts) for just this message — no thread refetch, so loaded
    // history and scroll position are preserved.
    onSuccess: (data, vars) => {
      queryClient.setQueryData(threadKey, (prev: AgentThreadCache | undefined) =>
        updateAgentThreadMessage(prev, vars.messageId, (m) => ({ ...m, reactions: data.reactions }))
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
    mutationFn: (vars: { messageId: ConversationMessageId; flagged: boolean }) =>
      setMessageFlagFn({ data: { messageId: vars.messageId, flagged: vars.flagged } }),
    onMutate: (vars) => {
      queryClient.setQueryData(threadKey, (prev: AgentThreadCache | undefined) =>
        updateAgentThreadMessage(prev, vars.messageId, (m) => ({
          ...m,
          flaggedAt: vars.flagged ? (m.flaggedAt ?? new Date().toISOString()) : null,
        }))
      )
    },
    onSuccess: (data, vars) => {
      queryClient.setQueryData(threadKey, (prev: AgentThreadCache | undefined) =>
        updateAgentThreadMessage(prev, vars.messageId, (m) => ({ ...m, flaggedAt: data.flaggedAt }))
      )
      // The "Saved for later" feed changed.
      void queryClient.invalidateQueries({ queryKey: conversationKeys.agentFlagged() })
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
    mutationFn: (messageId: ConversationMessageId) =>
      markConversationUnreadFromMessageFn({ data: { conversationId, messageId } }),
    onSuccess: () => onChanged(),
    onError: () => toast.error('Failed to mark unread'),
  })

  // Saved replies for the composer picker.
  const { data: cannedData } = useQuery({
    queryKey: conversationKeys.agentCannedReplies(),
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
      const text = note.text.trim()
      if (!text || noteMutation.isPending || uploading) return
      noteMutation.mutate({
        content: text,
        contentJson: note.docRef.current,
        attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
      })
      note.clear()
      return
    }
    // Reply is rich: send the plain text (preview/search) + the doc (inline
    // images/embeds) + any tray attachments. A doc/attachment with no text is
    // still valid (e.g. an image-only reply).
    const text = reply.text.trim()
    const doc = reply.docRef.current
    const hasAttachments = pendingAttachments.length > 0
    if (
      (!text && !docHasContentNode(doc) && !hasAttachments) ||
      sendMutation.isPending ||
      uploading
    )
      return
    sendMutation.mutate({
      content: text,
      contentJson: doc,
      attachments: hasAttachments ? pendingAttachments : undefined,
    })
    reply.clear()
  }, [reply, note, noteMode, noteMutation, pendingAttachments, uploading, sendMutation])

  // Render one virtualized row. AgentMessageBubble keeps all the agent-view
  // behaviors (and its data-message-id root); the affordance rows mirror the
  // old inline markup.
  const renderRow = (row: AdminConversationRow) => {
    switch (row.type) {
      case 'load-older':
        return (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="rounded-full border border-border/60 px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            >
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )
      case 'unread':
        return <UnreadDivider />
      case 'message': {
        const m = row.message
        return (
          <AgentMessageBubble
            message={m}
            highlighted={m.id === highlightId}
            onOpenPost={onOpenPost}
            onDelete={() => deleteMutation.mutate(m.id)}
            onToggleReaction={(emoji, hasReacted) =>
              reactionMutation.mutate({ messageId: m.id, emoji, hasReacted })
            }
            onToggleFlag={(next) => flagMutation.mutate({ messageId: m.id, flagged: next })}
            onMarkUnread={() => markUnreadMutation.mutate(m.id)}
            onSharePost={() => setShareMsg(m)}
            onTrackAsPost={() =>
              setConvertSeed({ title: m.content.trim().slice(0, 200), content: m.content })
            }
            onTrackSuggestion={(s) => setConvertSeed(s)}
            linkPreviews={linkPreviewsEnabled}
          />
        )
      }
      case 'empty':
        return <p className="py-8 text-center text-sm text-muted-foreground">No messages yet</p>
      case 'seen':
        return <p className="pe-1 text-end text-[10px] text-muted-foreground/50">Seen</p>
      case 'typing':
        return (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
            <TypingDots />
            <span>{conversation?.visitor.displayName ?? 'Visitor'} is typing…</span>
          </div>
        )
    }
  }

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
          {/* Conversation-level track entry for narrow viewports: at xl+ the
              detail panel's bottom "Track as feedback" button takes over, so this
              header trigger mirrors the triage controls' xl:hidden fallback. */}
          {conversation && (
            <div className="flex shrink-0 items-center gap-1.5 xl:hidden">
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
          {/* One controlled convert dialog; each entry point (per-message pick,
              AI note suggestion, the detail panel's conversation-level button)
              builds its own convertSeed. */}
          <ConvertToPostDialog
            open={!!convertSeed}
            onOpenChange={(o) => {
              if (!o) setConvertSeed(null)
            }}
            conversationId={conversationId}
            defaultTitle={convertSeed?.title ?? ''}
            defaultContent={convertSeed?.content ?? ''}
            defaultBoardId={convertSeed?.boardId}
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
          <EndConversationDialog
            open={endDialogOpen}
            onOpenChange={setEndDialogOpen}
            conversationId={conversationId}
            onEnded={refreshThread}
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

        {/* Messages — min-h-0 so this scrolls and the composer stays pinned. The
            wrapper is `relative` so the scroll-to-bottom pill can float over the
            thread. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ThreadViewport
            virtualizer={virtualizer}
            rows={rows}
            renderRow={renderRow}
            viewportRef={scrollRef}
            className="min-h-0 flex-1"
            rowClassName="px-5 py-1.5"
          />

          {/* Scroll-to-bottom pill: shown when scrolled up off the newest
              message; highlighted (primary + dot) when a message arrived while
              the agent was away from the bottom. */}
          {!atEnd && (
            <button
              type="button"
              onClick={() => {
                setHasNewBelow(false)
                virtualizer.scrollToIndex(rows.length - 1, { align: 'end', behavior: 'smooth' })
              }}
              className={cn(
                'absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md transition-colors',
                hasNewBelow
                  ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
              aria-label={hasNewBelow ? 'New messages — jump to latest' : 'Jump to latest'}
            >
              {hasNewBelow && (
                <>
                  <span className="size-1.5 rounded-full bg-primary-foreground" />
                  <span>New messages</span>
                </>
              )}
              <ChevronDownIcon className="h-4 w-4" />
            </button>
          )}
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
          {/* Composer: the editor spans the full width on top, then the pending
              attachment tray, then the actions (attach / emoji / saved replies)
              and send. Enter sends; Shift+Enter inserts a newline. */}
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
                // Reply and note both attach via the shared tray — uploaded and
                // sent as `attachments`, then rendered below the bubble.
                if (files && files.length > 0) void addFiles(files)
                e.target.value = ''
              }}
            />
            {noteMode ? (
              <ConversationNoteEditor
                ref={noteEditorRef}
                resetSignal={note.resetSignal}
                disabled={noteMutation.isPending}
                onChange={note.onChange}
                onSubmit={onSend}
                onImageFiles={(files) => void addFiles(files)}
              />
            ) : (
              <ConversationRichComposer
                ref={replyComposerRef}
                resetSignal={reply.resetSignal}
                disabled={sendMutation.isPending}
                placeholder="Type your reply…"
                onChange={reply.onChange}
                onSubmit={onSend}
                onLocalInput={onLocalInput}
                onImageFiles={(files) => void addFiles(files)}
              />
            )}
            <ComposerAttachmentTray attachments={pendingAttachments} onRemove={removeAttachment} />
            {/* Live link unfurl while composing (Slack-style) — part of the
                preview tray, gated by the flag. */}
            {linkPreviewsEnabled && <LinkPreviews content={debouncedComposerText} />}
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
                    ? !note.text.trim() || noteMutation.isPending || uploading
                    : (!reply.text.trim() &&
                        !reply.hasContentNode &&
                        pendingAttachments.length === 0) ||
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
          onEndConversation={() => setEndDialogOpen(true)}
          onTrackAsFeedback={() =>
            setConvertSeed({ title: trackConvoTitle, content: trackConvoContent })
          }
        />
      )}
    </div>
  )
}
