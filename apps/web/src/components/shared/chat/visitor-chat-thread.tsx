import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FormattedMessage, useIntl } from 'react-intl'
import { buildChatRows, type ChatRow } from './chat-rows'
import { ChatPresenceBadge } from './chat-presence-badge'
import { chatAvailable } from '@/lib/shared/chat/presence'
import { PaperAirplaneIcon, ChevronDownIcon } from '@heroicons/react/24/solid'
import { ChatBubbleLeftRightIcon, PaperClipIcon, BookOpenIcon } from '@heroicons/react/24/outline'
import type { ConversationId } from '@quackback/ids'
import { Avatar } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TypingDots } from '@/components/shared/typing-dots'
import { ChatAttachmentList } from '@/components/shared/chat-attachments'
import { EmojiPicker } from '@/components/shared/emoji-picker'
import { personalizeMessage, firstNameOf } from '@/lib/shared/chat/personalize'
import { useChatStream } from '@/lib/client/hooks/use-chat-stream'
import { useChatTyping } from '@/lib/client/hooks/use-chat-typing'
import { useChatComposerAttachments } from '@/lib/client/hooks/use-chat-composer-attachments'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { ComposerAttachmentTray } from '@/components/shared/composer-attachment-tray'
import {
  ChatRichComposer,
  type ChatRichComposerHandle,
} from '@/components/admin/chat/chat-rich-composer'
import { RichTextContent } from '@/components/ui/rich-text-editor'
import { EmbedHydration } from '@/components/shared/embed-hydration'
import type { EmbedOpenMode } from '@/components/shared/quackback-embed-card'
import { LinkPreviews } from '@/components/shared/link-preview-card'
import type { JSONContent } from '@tiptap/core'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { ChatAttachment, ConversationMessageDTO } from '@/lib/shared/chat/types'
import { isJumboEmojiMessage, JUMBO_EMOJI_CLASS } from '@/lib/shared/chat/jumbo-emoji'
import {
  getMyChatFn,
  sendConversationMessageFn,
  listConversationMessagesFn,
  markChatReadFn,
  mintChatStreamTokenFn,
  sendChatTypingFn,
  submitCsatFn,
} from '@/lib/server/functions/chat'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** True when the composer doc carries an inline image or post embed, which makes
 *  a message worth sending even with no typed text. Walks the doc since these are
 *  block atoms at the top level (and defensively, any nesting). */
function docHasContentNode(doc: JSONContent | null): boolean {
  if (!doc) return false
  const walk = (nodes: JSONContent[] | undefined): boolean =>
    !!nodes?.some((n) => n.type === 'chatImage' || n.type === 'quackbackEmbed' || walk(n.content))
  return walk(doc.content)
}

const NO_HEADERS = (): Record<string, string> => ({})
const ALWAYS_READY = async (): Promise<boolean> => true

export interface VisitorChatThreadPresence {
  agentsOnline: boolean
  withinOfficeHours: boolean | null
  nextOpenAt: string | null
}

export interface VisitorChatThreadProps {
  /** Which thread to open: an id opens that thread, 'new' starts a fresh one,
   *  undefined resumes the visitor's active/most-recent thread. */
  conversationTarget?: ConversationId | 'new'
  /** When true, render link preview cards below message bubbles. */
  linkPreviews?: boolean
  /** Auth headers attached to every server call. The widget injects its Bearer
   *  token; portal/session surfaces ride on cookies and pass nothing. */
  getAuthHeaders?: () => Record<string, string>
  /** Ensure an authenticated session exists before a send or upload (the widget
   *  lazily mints anonymous sessions). Session surfaces omit it (always ready). */
  ensureSession?: () => Promise<boolean>
  /** Bumps when the underlying principal changes; reloads the thread. */
  sessionVersion?: number | string
  /** The visitor's own identity, for their bubbles' name/avatar. */
  currentUser?: { name?: string | null; avatarUrl?: string | null } | null
  /** Upload one image file, resolving to its public URL. Rejections surface as
   *  inline composer errors. */
  uploadImage: (file: File) => Promise<string>
  /** Team availability (online agents / office hours), owned by the surface so
   *  every sibling view shares one poll. */
  presence: VisitorChatThreadPresence
  /** Live agent activity observed on the stream (message/typing) — lets the
   *  surface mark agents present in its own presence cache. */
  onAgentActivity?: () => void
  /** Optional help-article deflection while composing the first message. */
  helpSearch?: {
    search: (q: string, signal: AbortSignal) => Promise<Array<{ slug: string; title: string }>>
    onSelect: (slug: string) => void
  }
  /** How embedded post cards open. The widget's iframe opens a new tab. */
  embedOpenMode?: EmbedOpenMode
  /** Notified when the first send creates the conversation. */
  onConversationStarted?: (id: ConversationId) => void
}

/**
 * The visitor side of a conversation: virtualized thread, live SSE updates,
 * composer (rich text + image attachments + emoji), pre-chat email capture,
 * presence strip, offline hints, and the post-conversation CSAT prompt.
 *
 * Shared by the widget chat tab and the portal Support tab — every
 * surface-specific dependency (auth headers, session minting, presence,
 * uploads, help search) comes in through props.
 */
export function VisitorChatThread({
  conversationTarget,
  linkPreviews = false,
  getAuthHeaders = NO_HEADERS,
  ensureSession = ALWAYS_READY,
  sessionVersion = 0,
  currentUser,
  uploadImage,
  presence,
  onAgentActivity,
  helpSearch,
  embedOpenMode = 'newTab',
  onConversationStarted,
}: VisitorChatThreadProps) {
  const intl = useIntl()
  const firstName = firstNameOf(currentUser?.name)

  const [loading, setLoading] = useState(true)
  const [conversationId, setConversationId] = useState<ConversationId | null>(null)
  const [messages, setMessages] = useState<ConversationMessageDTO[]>([])
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null)
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null)
  const [teamName, setTeamName] = useState<string | null>(null)
  const [agentReadAt, setAgentReadAt] = useState<string | null>(null)
  // Pre-chat email capture (anonymous visitors). Data-driven: identified
  // visitors come back with visitorHasEmail=true, so the prompt never shows.
  const [preChatMode, setPreChatMode] = useState<'off' | 'optional' | 'required'>('off')
  const [emailKnown, setEmailKnown] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  // Whether an offline reply could actually reach this visitor by email — drives
  // the offline copy so the surface never promises email it can't send.
  const [canEmailReply, setCanEmailReply] = useState(false)
  // Older-message pagination.
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [conversationStatus, setConversationStatus] = useState<string | null>(null)
  const [csatRating, setCsatRating] = useState<number | null>(null)
  // Whether the visitor rated in THIS session — enables the optional comment
  // follow-up. A returning, already-rated visitor goes straight to "thanks".
  const [csatJustRated, setCsatJustRated] = useState(false)
  const [csatCommentDone, setCsatCommentDone] = useState(false)
  const [csatComment, setCsatComment] = useState('')
  // Composer is a rich TipTap doc (inline images + post embeds). `messageText` is
  // the doc's plain text (gates send + drives help-search/typing); `messageDocRef`
  // holds the doc persisted as contentJson; `composerResetSignal` clears the
  // editor after a successful send.
  const [messageText, setMessageText] = useState('')
  const messageDocRef = useRef<JSONContent | null>(null)
  const [messageHasContentNode, setMessageHasContentNode] = useState(false)
  const [composerResetSignal, setComposerResetSignal] = useState(0)
  const [sending, setSending] = useState(false)

  const scrollViewportRef = useRef<HTMLDivElement>(null)
  // Monotonic CSAT submit counter: a later submit (comment) bumps it so a stale
  // rating-request failure can't roll back state the visitor has moved past.
  const csatSubmitGenRef = useRef(0)

  const appendMessage = useCallback((msg: ConversationMessageDTO) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
  }, [])

  const sendTyping = useCallback(() => {
    if (!conversationId) return
    void sendChatTypingFn({
      data: { conversationId },
      headers: getAuthHeaders(),
    }).catch(() => {})
  }, [conversationId, getAuthHeaders])
  const { remoteTyping, onLocalInput, onRemoteTyping, clearRemoteTyping } =
    useChatTyping(sendTyping)

  // No toast on visitor surfaces, so upload failures render as inline composer
  // text. uploadImage rejects on failure; the wrapper records the message.
  const [uploadError, setUploadError] = useState<string | null>(null)
  const upload = useCallback(
    async (file: File): Promise<string> => {
      try {
        return await uploadImage(file)
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed')
        throw err
      }
    },
    [uploadImage]
  )
  // Image attachments use the shared tray (thumbnails + zoom) — same as admin.
  const {
    pending: pendingAttachments,
    addFiles,
    remove: removeAttachment,
    clear: clearAttachments,
    uploading,
  } = useChatComposerAttachments(upload)
  // Attaching/pasting an image fires before the visitor has ever sent a message,
  // so there may be no session yet — mint one first (anonymous is fine) or the
  // upload goes out with no Bearer and 401s silently.
  const handleAddFiles = useCallback(
    async (files: FileList | File[]) => {
      // Snapshot to a real array NOW: the file <input>'s live FileList is emptied
      // by `e.target.value = ''` synchronously after this call, before the
      // ensureSession() await below resolves — so reading it later loses the pick.
      const list = Array.from(files)
      if (list.length === 0) return
      setUploadError(null)
      const ready = await ensureSession()
      if (!ready) {
        setUploadError(
          intl.formatMessage({
            id: 'widget.chat.upload.failed',
            defaultMessage: "Couldn't upload that image. Please try again.",
          })
        )
        return
      }
      await addFiles(list)
    },
    [ensureSession, addFiles, intl]
  )
  // Live link unfurl while composing (debounced), matching admin.
  const debouncedMessageText = useDebouncedValue(messageText, 500)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<ChatRichComposerHandle>(null)

  // Initial load — resumes an existing conversation for the current principal
  // (works without forcing a session: getMyChat returns just the greeting when
  // there's no session yet). Re-keyed on sessionVersion so it reloads after
  // identify swaps the actor.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await getMyChatFn({
          // 'new' → null (blank greeting); an id → that thread; undefined → active.
          data: {
            conversationId: conversationTarget === 'new' ? null : (conversationTarget ?? undefined),
          },
          headers: getAuthHeaders(),
        })
        if (cancelled) return
        setWelcomeMessage(res.welcomeMessage)
        setOfflineMessage(res.offlineMessage)
        setTeamName(res.teamName)
        setPreChatMode(res.preChatEmail)
        setCanEmailReply(res.canEmailVisitor)
        setEmailKnown(res.visitorHasEmail)
        setHasMoreOlder(res.hasMore)
        setConversationId((res.conversation?.id as ConversationId | undefined) ?? null)
        setAgentReadAt(res.conversation?.agentLastReadAt ?? null)
        setConversationStatus(res.conversation?.status ?? null)
        setCsatRating(res.conversation?.csatRating ?? null)
        setMessages(res.messages)
      } catch {
        /* leave greeting-only state */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // getAuthHeaders is identity-stable per surface; sessionVersion is the reload key.
  }, [sessionVersion, conversationTarget])

  // Refetch the authoritative thread after a reconnect to catch anything missed.
  const refreshMessages = useCallback(async () => {
    if (!conversationId) return
    try {
      const page = await listConversationMessagesFn({
        data: { conversationId },
        headers: getAuthHeaders(),
      })
      setMessages(page.messages)
      setHasMoreOlder(page.hasMore)
    } catch {
      /* keep current messages */
    }
  }, [conversationId, getAuthHeaders])

  // Prepend an older page (keyset cursor = oldest loaded message id).
  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder || messages.length === 0) return
    setLoadingOlder(true)
    try {
      const page = await listConversationMessagesFn({
        data: { conversationId, before: messages[0].id },
        headers: getAuthHeaders(),
      })
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        return [...page.messages.filter((m) => !known.has(m.id)), ...prev]
      })
      setHasMoreOlder(page.hasMore)
    } catch {
      /* keep current messages */
    } finally {
      setLoadingOlder(false)
    }
  }, [conversationId, loadingOlder, messages, getAuthHeaders])

  useChatStream({
    enabled: conversationId != null,
    resetKey: conversationId ?? '',
    buildUrl: async () => {
      if (!conversationId) return null
      try {
        const { token } = await mintChatStreamTokenFn({ headers: getAuthHeaders() })
        if (!token) return null
        return `/api/chat/stream?conversationId=${encodeURIComponent(
          conversationId
        )}&token=${encodeURIComponent(token)}`
      } catch {
        return null
      }
    },
    onEvent: (evt) => {
      if (evt.kind === 'message') {
        appendMessage(evt.message)
        if (evt.message.senderType === 'agent') {
          clearRemoteTyping()
          onAgentActivity?.() // an agent is clearly here right now
        }
      } else if (evt.kind === 'typing' && evt.side === 'agent') {
        onRemoteTyping()
        onAgentActivity?.()
      } else if (evt.kind === 'read' && evt.side === 'agent') {
        setAgentReadAt(evt.at)
      } else if (evt.kind === 'message_deleted') {
        setMessages((prev) => prev.filter((m) => m.id !== evt.messageId))
      } else if (evt.kind === 'conversation' && evt.conversation.id === conversationId) {
        setConversationStatus(evt.conversation.status)
        setCsatRating(evt.conversation.csatRating)
      }
    },
    onReconnect: () => void refreshMessages(),
  })

  // A star click records the rating immediately (so it's never lost), then the
  // surface offers an optional comment as a follow-up.
  const submitRating = useCallback(
    (rating: number) => {
      if (!conversationId) return
      const gen = ++csatSubmitGenRef.current
      setCsatRating(rating)
      setCsatJustRated(true)
      void submitCsatFn({
        data: { conversationId, rating },
        headers: getAuthHeaders(),
      }).catch(() => {
        // Roll back so the stars reappear for a retry — unless a later CSAT
        // submit (e.g. the comment) already superseded this request.
        if (csatSubmitGenRef.current === gen) {
          setCsatRating(null)
          setCsatJustRated(false)
        }
      })
    },
    [conversationId, getAuthHeaders]
  )

  // Optional follow-up: attach a comment to the rating already on file.
  const submitComment = useCallback(() => {
    if (!conversationId || csatRating == null) return
    csatSubmitGenRef.current++ // supersede any in-flight rating-submit rollback
    setCsatCommentDone(true)
    const trimmed = csatComment.trim()
    void submitCsatFn({
      data: { conversationId, rating: csatRating, comment: trimmed || undefined },
      headers: getAuthHeaders(),
    }).catch(() => setCsatCommentDone(false)) // reopen the box for a retry on failure
  }, [conversationId, csatRating, csatComment, getAuthHeaders])

  // Prompt for a rating once the conversation is closed and not yet rated.
  const showCsatPrompt =
    !!conversationId && conversationStatus === 'closed' && csatRating == null && messages.length > 0

  // Help-center deflection: as the visitor types their first message (before a
  // conversation exists), suggest relevant articles so they can self-serve.
  const [helpResults, setHelpResults] = useState<Array<{ slug: string; title: string }>>([])
  const helpSearchFn = helpSearch?.search
  useEffect(() => {
    if (!helpSearchFn || conversationId || messages.length > 0) {
      setHelpResults([])
      return
    }
    const q = messageText.trim()
    if (q.length < 3) {
      setHelpResults([])
      return
    }
    const controller = new AbortController()
    const t = setTimeout(async () => {
      try {
        setHelpResults(await helpSearchFn(q, controller.signal))
      } catch {
        /* aborted or failed — leave suggestions as-is */
      }
    }, 300)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [messageText, helpSearchFn, conversationId, messages.length])

  // The newest visitor message is "Seen" once the agent's read watermark
  // reaches it.
  const lastVisitorMessage = [...messages].reverse().find((m) => m.senderType === 'visitor')
  const lastVisitorSeen =
    !!agentReadAt &&
    !!lastVisitorMessage &&
    new Date(agentReadAt).getTime() >= new Date(lastVisitorMessage.createdAt).getTime()

  // Availability shown to the visitor: a live agent always counts as online;
  // when office hours are configured, the schedule also marks us available.
  const available = chatAvailable(presence.agentsOnline, presence.withinOfficeHours)

  // "Back at" time for the away state, formatted in the visitor's own locale.
  const reopenLabel = useMemo(() => {
    if (!presence.nextOpenAt) return null
    const at = new Date(presence.nextOpenAt)
    if (Number.isNaN(at.getTime())) return null
    return new Intl.DateTimeFormat(intl.locale, {
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
    }).format(at)
  }, [presence.nextOpenAt, intl.locale])

  // Pre-chat email: prompt only before the conversation starts, for anonymous
  // visitors, when configured. 'required' blocks sending until a valid address.
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim())
  const needsEmail =
    preChatMode !== 'off' && !emailKnown && !conversationId && messages.length === 0
  const emailBlocksSend = preChatMode === 'required' && needsEmail && !emailValid
  // Show the offline hint when the team is away. When we can email a reply, only
  // echo the admin's message if one is set; when we can't, always show the
  // neutral "we'll reply here" note instead of a false email promise.
  const showOfflineHint = !available && (canEmailReply ? Boolean(offlineMessage) : true)

  // Flatten the thread into virtualized rows. anchorTo:'end' + followOnAppend
  // keep the view pinned to the newest message and stick to the bottom as
  // messages stream in; getItemKey (message id) lets the virtualizer hold the
  // viewport when older history is prepended.
  const hasGreeting = !hasMoreOlder && !!welcomeMessage
  const showEmpty = !loading && messages.length === 0 && !welcomeMessage
  const rows = useMemo(
    () =>
      buildChatRows({
        messages,
        hasMoreOlder,
        hasGreeting,
        showEmpty,
        showSeen: lastVisitorSeen && !remoteTyping,
        showTyping: remoteTyping,
        // Only while closed: a reopen (agent reply / new visitor message) must
        // drop the rating prompt, the comment follow-up, and the thanks notice.
        showCsat: conversationStatus === 'closed' && (showCsatPrompt || csatRating != null),
      }),
    [
      messages,
      hasMoreOlder,
      hasGreeting,
      showEmpty,
      lastVisitorSeen,
      remoteTyping,
      showCsatPrompt,
      csatRating,
      conversationStatus,
    ]
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollViewportRef.current,
    estimateSize: () => 64,
    getItemKey: (index) => rows[index].key,
    anchorTo: 'end',
    followOnAppend: true,
    overscan: 6,
  })

  // Land on the newest message once the initial thread has loaded.
  const didInitialScroll = useRef(false)
  useLayoutEffect(() => {
    if (loading || didInitialScroll.current || rows.length === 0) return
    didInitialScroll.current = true
    virtualizer.scrollToEnd()
  }, [loading, rows.length, virtualizer])

  // Clear unread on the visitor side only when the newest message is from an
  // agent — skip the visitor's own outbound sends (avoids a write + 'read'
  // broadcast on every send). Keyed on the last message id so benign array
  // re-creation doesn't re-fire the write.
  const lastMessageId = messages.at(-1)?.id
  useEffect(() => {
    if (!conversationId) return
    if (messages.at(-1)?.senderType !== 'agent') return
    void markChatReadFn({ data: { conversationId }, headers: getAuthHeaders() }).catch(() => {})
  }, [conversationId, lastMessageId])

  const send = useCallback(async () => {
    const text = messageText.trim()
    const doc = messageDocRef.current
    const hasAttachments = pendingAttachments.length > 0
    // Sendable when there's typed text, an inline embed, or a tray attachment.
    if (
      (!text && !docHasContentNode(doc) && !hasAttachments) ||
      sending ||
      uploading ||
      emailBlocksSend
    )
      return
    setSending(true)

    const ready = await ensureSession()
    if (!ready) {
      // Leave the composer content intact so a failed send doesn't discard it.
      setSending(false)
      return
    }
    try {
      const res = await sendConversationMessageFn({
        data: {
          conversationId: conversationId ?? undefined,
          content: text,
          // Embeds ride along as the (server-sanitized) TipTap doc; images go as
          // attachments (the tray) — matching admin.
          contentJson: doc,
          attachments: hasAttachments ? pendingAttachments : undefined,
          // Attach the captured email on the first message only.
          visitorEmail: needsEmail && emailValid ? emailInput.trim() : undefined,
        },
        headers: getAuthHeaders(),
      })
      const isNewConversation = !conversationId
      setConversationId(res.conversation.id as ConversationId)
      // Adopt the server's status so a reply that reopens a closed thread clears
      // the "closed / reply to reopen" hint (and its CSAT prompt) immediately.
      setConversationStatus(res.conversation.status)
      appendMessage(res.message)
      if (isNewConversation) {
        onConversationStarted?.(res.conversation.id as ConversationId)
      }
      if (needsEmail && emailValid) setEmailKnown(true)
      // Clear the composer only on success — the resetSignal bump empties the editor.
      setMessageText('')
      messageDocRef.current = null
      setMessageHasContentNode(false)
      setComposerResetSignal((n) => n + 1)
      clearAttachments()
      setUploadError(null)
    } catch {
      // Leave the composer content intact for a retry.
    } finally {
      setSending(false)
    }
  }, [
    messageText,
    sending,
    emailBlocksSend,
    needsEmail,
    emailValid,
    emailInput,
    conversationId,
    ensureSession,
    appendMessage,
    pendingAttachments,
    uploading,
    clearAttachments,
    getAuthHeaders,
    onConversationStarted,
  ])

  const renderRow = (row: ChatRow) => {
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
              {loadingOlder ? (
                <FormattedMessage id="widget.chat.loadingOlder" defaultMessage="Loading…" />
              ) : (
                <FormattedMessage
                  id="widget.chat.loadOlder"
                  defaultMessage="Load earlier messages"
                />
              )}
            </button>
          </div>
        )
      case 'greeting':
        return (
          <ChatBubble
            authorName={teamName ?? undefined}
            content={personalizeMessage(welcomeMessage ?? '', firstName)}
            embedOpenMode={embedOpenMode}
          />
        )
      case 'message': {
        const m = row.message
        const isVisitor = m.senderType === 'visitor'
        return (
          <ChatBubble
            authorName={
              isVisitor
                ? (currentUser?.name ??
                  intl.formatMessage({ id: 'widget.chat.you', defaultMessage: 'You' }))
                : (m.author?.displayName ?? teamName ?? undefined)
            }
            authorAvatar={
              isVisitor ? (currentUser?.avatarUrl ?? null) : (m.author?.avatarUrl ?? null)
            }
            content={m.content}
            contentJson={m.contentJson}
            attachments={m.attachments}
            time={formatTime(m.createdAt)}
            linkPreviews={linkPreviews}
            getAuthHeaders={getAuthHeaders}
            embedOpenMode={embedOpenMode}
          />
        )
      }
      case 'system': {
        // Localize from the structured event; fall back to the stored (English)
        // content for legacy rows or unknown kinds.
        const event = row.message.systemEvent
        const notice =
          event?.kind === 'chat_ended' ? (
            <FormattedMessage id="widget.chat.system.ended" defaultMessage="Chat ended" />
          ) : event?.kind === 'chat_reopened' ? (
            <FormattedMessage id="widget.chat.system.reopened" defaultMessage="Chat reopened" />
          ) : event?.kind === 'assigned' ? (
            <FormattedMessage
              id="widget.chat.system.assigned"
              defaultMessage="Assigned to {name}"
              values={{ name: event.agentName ?? 'an agent' }}
            />
          ) : (
            row.message.content
          )
        return (
          <div className="flex items-center gap-2 py-1" role="status">
            <span className="h-px flex-1 bg-border/50" />
            <span className="text-center text-[11px] text-muted-foreground">{notice}</span>
            <span className="h-px flex-1 bg-border/50" />
          </div>
        )
      }
      case 'empty':
        return (
          <div className="flex flex-col items-center justify-center text-center py-8 px-4">
            <ChatBubbleLeftRightIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm font-medium text-muted-foreground/70">
              <FormattedMessage
                id="widget.chat.startPrompt"
                defaultMessage="Send us a message and we'll get back to you."
              />
            </p>
          </div>
        )
      case 'seen':
        return (
          <p className="text-end text-[10px] text-muted-foreground/50 pe-1">
            <FormattedMessage id="widget.chat.seen" defaultMessage="Seen" />
          </p>
        )
      case 'typing':
        return (
          <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground/70">
            <TypingDots />
            <span>
              <FormattedMessage
                id="widget.chat.typing"
                defaultMessage="{name} is typing…"
                values={{ name: teamName ?? 'Support' }}
              />
            </span>
          </div>
        )
      case 'csat':
        return (
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 text-center">
            {csatRating == null ? (
              // Step 1: rate. A click records the rating right away.
              <>
                <p className="mb-1.5 text-xs text-muted-foreground">
                  <FormattedMessage
                    id="widget.chat.csat.prompt"
                    defaultMessage="How was your conversation?"
                  />
                </p>
                <div className="flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => submitRating(n)}
                      className="text-lg leading-none text-muted-foreground/50 transition-colors hover:text-amber-500"
                      aria-label={`Rate ${n} of 5`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </>
            ) : csatJustRated && !csatCommentDone ? (
              // Step 2: rating recorded — offer an optional comment.
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  <FormattedMessage
                    id="widget.chat.csat.commentPrompt"
                    defaultMessage="Thanks! Anything we could improve?"
                  />
                </p>
                <textarea
                  value={csatComment}
                  onChange={(e) => setCsatComment(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  // The visible prompt <p> above already labels this section, so
                  // name the field by its own purpose to avoid a double announce.
                  aria-label={intl.formatMessage({
                    id: 'widget.chat.csat.commentPlaceholder',
                    defaultMessage: 'Add a comment (optional)',
                  })}
                  placeholder={intl.formatMessage({
                    id: 'widget.chat.csat.commentPlaceholder',
                    defaultMessage: 'Add a comment (optional)',
                  })}
                  className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={submitComment}
                  className="self-center rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <FormattedMessage id="widget.chat.csat.send" defaultMessage="Send feedback" />
                </button>
              </div>
            ) : (
              // Final state: commented, or a returning already-rated visitor.
              <p className="text-xs text-muted-foreground">
                <FormattedMessage
                  id="widget.chat.csat.thanks"
                  defaultMessage="Thanks for your feedback!"
                />
              </p>
            )}
          </div>
        )
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Presence strip */}
      <div className="flex items-center px-4 py-2 border-b border-border/40 shrink-0">
        <ChatPresenceBadge available={available} />
      </div>

      <div className="relative flex-1 min-h-0">
        <ScrollArea viewportRef={scrollViewportRef} scrollBarClassName="w-1.5" className="h-full">
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((vi) => (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <div className="px-3 py-1.5">{renderRow(rows[vi.index])}</div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Jump to latest — shown only when the visitor has scrolled up to read
            history (followOnAppend keeps the view pinned when already at end). */}
        {!virtualizer.isAtEnd() && (
          <button
            type="button"
            onClick={() => virtualizer.scrollToEnd({ behavior: 'smooth' })}
            aria-label={intl.formatMessage({
              id: 'widget.chat.jumpToLatest',
              defaultMessage: 'Jump to latest',
            })}
            className="absolute bottom-2 end-2 z-10 flex items-center justify-center size-8 rounded-full border border-border bg-card text-muted-foreground shadow-md hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronDownIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Help-center deflection: suggested articles as the visitor types. */}
      {helpResults.length > 0 && (
        <div className="px-3 pb-1">
          <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
            <FormattedMessage
              id="widget.chat.suggestedArticles"
              defaultMessage="Suggested articles"
            />
          </p>
          <div className="flex flex-col gap-1">
            {helpResults.map((a) => (
              <button
                key={a.slug}
                type="button"
                onClick={() => helpSearch?.onSelect(a.slug)}
                className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/20 px-2 py-1.5 text-left text-xs hover:bg-muted/40 transition-colors"
              >
                <BookOpenIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Offline hint (see showOfflineHint): echo the admin's email-promising
          message only when a reply can actually reach them; otherwise a neutral
          "reply here" note. */}
      {showOfflineHint && (
        <div className="px-4 pt-2 text-center text-[11px] text-muted-foreground/70">
          <p>
            {canEmailReply ? (
              offlineMessage
            ) : (
              <FormattedMessage
                id="widget.chat.offline.noEmail"
                defaultMessage="We're away right now — leave a message and we'll reply here when we're back."
              />
            )}
          </p>
          {reopenLabel && (
            <p className="mt-0.5">
              <FormattedMessage
                id="widget.chat.offline.backAt"
                defaultMessage="Back {when}"
                values={{ when: reopenLabel }}
              />
            </p>
          )}
        </div>
      )}

      {/* Composer is always available. A closed thread reopens on the next send
          (Intercom-style), so we keep the composer and only hint at the state. */}
      {conversationStatus === 'closed' && (
        <div className="flex items-center gap-2 px-3 pt-2" role="status">
          <span className="h-px flex-1 bg-border/50" />
          <span className="text-center text-[11px] text-muted-foreground">
            <FormattedMessage
              id="widget.chat.closedReopen"
              defaultMessage="This conversation was closed. Reply to reopen it."
            />
          </span>
          <span className="h-px flex-1 bg-border/50" />
        </div>
      )}
      <div className="border-t border-border/40 p-2 shrink-0">
        {/* Pre-chat email capture (anonymous visitors). */}
        {needsEmail && (
          <div className="px-1 pb-2">
            <label
              htmlFor="visitor-chat-email"
              className="mb-1 block text-[11px] font-medium text-muted-foreground"
            >
              {preChatMode === 'required' ? (
                <FormattedMessage
                  id="widget.chat.email.required"
                  defaultMessage="Your email so we can reply"
                />
              ) : (
                <FormattedMessage
                  id="widget.chat.email.optional"
                  defaultMessage="Your email (optional)"
                />
              )}
            </label>
            <input
              id="visitor-chat-email"
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
            {/* Optional mode: an explicit skip so blank-and-send is a choice,
                not a silent fallthrough. */}
            {preChatMode === 'optional' && (
              <button
                type="button"
                onClick={() => setEmailKnown(true)}
                className="mt-1 text-[11px] text-muted-foreground/70 underline hover:text-foreground"
              >
                <FormattedMessage
                  id="widget.chat.email.skip"
                  defaultMessage="Continue without email"
                />
              </button>
            )}
          </div>
        )}
        {/* Composer: a rich editor on top (inline images via paste/drop +
              the attach button, and post links become embed cards), actions
              (attach / emoji / send) on the row below. Enter sends; Shift+Enter
              inserts a newline and the editor auto-grows to fit. */}
        <div className="rounded-lg border border-border bg-background px-2.5 py-2 focus-within:ring-2 focus-within:ring-primary/20">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              // Attach via the shared tray (thumbnails + zoom), same as admin.
              const files = e.target.files
              if (files && files.length > 0) void handleAddFiles(files)
              e.target.value = ''
            }}
          />
          <ChatRichComposer
            ref={composerRef}
            resetSignal={composerResetSignal}
            disabled={sending || emailBlocksSend}
            placeholder={intl.formatMessage({
              id: 'widget.chat.placeholder',
              defaultMessage: 'Type your message…',
            })}
            onChange={(text, doc) => {
              setMessageText(text)
              messageDocRef.current = doc
              setMessageHasContentNode(docHasContentNode(doc))
            }}
            onSubmit={() => void send()}
            onLocalInput={onLocalInput}
            onImageFiles={(files) => void handleAddFiles(files)}
          />
          <ComposerAttachmentTray attachments={pendingAttachments} onRemove={removeAttachment} />
          {uploadError && <p className="px-1 pt-1 text-[11px] text-destructive">{uploadError}</p>}
          {/* Live link unfurl while composing (Slack-style), gated by the flag. */}
          {linkPreviews && (
            <LinkPreviews content={debouncedMessageText} getAuthHeaders={getAuthHeaders} />
          )}
          <div className="flex items-center gap-0.5 pt-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
              aria-label={intl.formatMessage({
                id: 'widget.chat.attach',
                defaultMessage: 'Attach image',
              })}
            >
              <PaperClipIcon className="w-5 h-5" />
            </button>
            <EmojiPicker
              className="size-8"
              onSelect={(emoji) => composerRef.current?.insertText(emoji)}
            />
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void send()}
              disabled={
                (!messageText.trim() &&
                  !messageHasContentNode &&
                  pendingAttachments.length === 0) ||
                sending ||
                uploading ||
                emailBlocksSend
              }
              className="shrink-0 flex items-center justify-center size-8 rounded-md bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
              aria-label={intl.formatMessage({ id: 'widget.chat.send', defaultMessage: 'Send' })}
            >
              <PaperAirplaneIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ChatBubbleProps {
  content: string
  /** Rich TipTap doc (inline images / post embeds). When present it renders in
   *  place of the plain-text `content`; messages without it keep the text path. */
  contentJson?: TiptapContent | null
  authorName?: string
  authorAvatar?: string | null
  attachments?: ChatAttachment[]
  time?: string
  linkPreviews?: boolean
  getAuthHeaders?: () => Record<string, string>
  embedOpenMode?: EmbedOpenMode
}

/**
 * A single chat row in the threaded layout: the author's avatar on the left,
 * their name (and time) on top, and the message content below. Visitor and
 * agent messages render identically — the avatar + name carry the "who".
 */
function ChatBubble({
  content,
  contentJson,
  authorName,
  authorAvatar,
  attachments,
  time,
  linkPreviews = false,
  getAuthHeaders,
  embedOpenMode = 'newTab',
}: ChatBubbleProps) {
  return (
    <div className="flex gap-2.5">
      <Avatar
        src={authorAvatar ?? null}
        name={authorName ?? 'Support'}
        className="mt-0.5 size-9 shrink-0 text-xs"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {authorName && (
            <span className="truncate text-xs font-semibold text-foreground">{authorName}</span>
          )}
          {time && <span className="shrink-0 text-[10px] text-muted-foreground/50">{time}</span>}
        </div>
        {isJumboEmojiMessage(content, contentJson) ? (
          // A lone-emoji message renders large (Slack/iMessage style).
          <div className={JUMBO_EMOJI_CLASS}>{content}</div>
        ) : contentJson ? (
          // Rich message (inline images / post embeds): hydrate embed cards into
          // the static rendered HTML, matching the changelog/inbox surfaces. The
          // widget's iframe origin may differ from the portal's, so an embedded
          // post opens its absolute URL in a new tab there.
          <EmbedHydration openMode={embedOpenMode} getAuthHeaders={getAuthHeaders}>
            <RichTextContent
              content={contentJson}
              className="mt-0.5 text-sm leading-relaxed text-foreground/90"
            />
          </EmbedHydration>
        ) : (
          content && (
            <div className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
              {content}
            </div>
          )
        )}
        {attachments && attachments.length > 0 && <ChatAttachmentList attachments={attachments} />}
        {linkPreviews && (
          <LinkPreviews
            content={content}
            contentJson={contentJson}
            getAuthHeaders={getAuthHeaders}
          />
        )}
      </div>
    </div>
  )
}
