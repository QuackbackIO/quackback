import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FormattedMessage, useIntl } from 'react-intl'
import { buildChatRows, type ChatRow } from './widget-chat-rows'
import { chatAvailable } from '@/lib/shared/chat/presence'
import { PaperAirplaneIcon, ChevronDownIcon } from '@heroicons/react/24/solid'
import {
  ChatBubbleLeftRightIcon,
  PaperClipIcon,
  XMarkIcon,
  BookOpenIcon,
} from '@heroicons/react/24/outline'
import type { ConversationId } from '@quackback/ids'
import { Avatar } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TypingDots } from '@/components/shared/typing-dots'
import { ChatAttachmentList } from '@/components/shared/chat-attachments'
import { EmojiPicker } from '@/components/shared/emoji-picker'
import { cn } from '@/lib/shared/utils'
import { useWidgetAuth } from './widget-auth-provider'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useChatStream } from '@/lib/client/hooks/use-chat-stream'
import { useChatTyping } from '@/lib/client/hooks/use-chat-typing'
import { useWidgetImageUpload } from '@/lib/client/hooks/use-image-upload'
import { useChatComposerAttachments } from '@/lib/client/hooks/use-chat-composer-attachments'
import type { ChatAttachment, ChatMessageDTO } from '@/lib/shared/chat/types'
import {
  getMyChatFn,
  getChatPresenceFn,
  sendChatMessageFn,
  listChatMessagesFn,
  markChatReadFn,
  mintChatStreamTokenFn,
  sendChatTypingFn,
  submitCsatFn,
} from '@/lib/server/functions/chat'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

interface WidgetLiveChatProps {
  /** Whether the help center is available (gates in-chat article suggestions). */
  helpEnabled?: boolean
  /** Open a help article by slug (switches the widget to the article view). */
  onArticleSelect?: (slug: string) => void
}

export function WidgetLiveChat({ helpEnabled, onArticleSelect }: WidgetLiveChatProps = {}) {
  const intl = useIntl()
  const { ensureSession, sessionVersion } = useWidgetAuth()

  const [loading, setLoading] = useState(true)
  const [conversationId, setConversationId] = useState<ConversationId | null>(null)
  const [messages, setMessages] = useState<ChatMessageDTO[]>([])
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null)
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null)
  const [teamName, setTeamName] = useState<string | null>(null)
  const [agentsOnline, setAgentsOnline] = useState(false)
  // null = no office-hours schedule; true/false = the schedule's verdict at load.
  const [withinOfficeHours, setWithinOfficeHours] = useState<boolean | null>(null)
  const [agentReadAt, setAgentReadAt] = useState<string | null>(null)
  // Pre-chat email capture (anonymous visitors).
  const [preChatMode, setPreChatMode] = useState<'off' | 'optional' | 'required'>('off')
  const [emailKnown, setEmailKnown] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  // Older-message pagination.
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [conversationStatus, setConversationStatus] = useState<string | null>(null)
  const [csatRating, setCsatRating] = useState<number | null>(null)
  const [csatSubmitted, setCsatSubmitted] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const scrollViewportRef = useRef<HTMLDivElement>(null)

  const appendMessage = useCallback((msg: ChatMessageDTO) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
  }, [])

  const sendTyping = useCallback(() => {
    if (!conversationId) return
    void sendChatTypingFn({
      data: { conversationId },
      headers: getWidgetAuthHeaders(),
    }).catch(() => {})
  }, [conversationId])
  const { remoteTyping, onLocalInput, onRemoteTyping, clearRemoteTyping } =
    useChatTyping(sendTyping)

  const { upload } = useWidgetImageUpload()
  const {
    pending: pendingAttachments,
    addFiles,
    remove: removeAttachment,
    clear: clearAttachments,
    uploading,
  } = useChatComposerAttachments(upload)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initial load — resumes an existing conversation for the current principal
  // (works without forcing a session: getMyChat returns just the greeting when
  // there's no session yet). Re-keyed on sessionVersion so it reloads after
  // identify swaps the actor.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await getMyChatFn({ headers: getWidgetAuthHeaders() })
        if (cancelled) return
        setWelcomeMessage(res.welcomeMessage)
        setOfflineMessage(res.offlineMessage)
        setTeamName(res.teamName)
        setAgentsOnline(res.agentsOnline)
        setWithinOfficeHours(res.withinOfficeHours)
        setPreChatMode(res.preChatEmail)
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
  }, [sessionVersion])

  // Keep presence fresh while the chat is open. The SSE stream flips us online
  // the moment an agent acts; this poll catches the reverse (agents going
  // offline) and office-hours changes. Presence-only — never touches messages.
  useEffect(() => {
    let cancelled = false
    const poll = () =>
      void getChatPresenceFn({ headers: getWidgetAuthHeaders() })
        .then((p) => {
          if (cancelled) return
          setAgentsOnline(p.agentsOnline)
          setWithinOfficeHours(p.withinOfficeHours)
        })
        .catch(() => {})
    const id = setInterval(poll, 45_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [sessionVersion])

  // Refetch the authoritative thread after a reconnect to catch anything missed.
  const refreshMessages = useCallback(async () => {
    if (!conversationId) return
    try {
      const page = await listChatMessagesFn({
        data: { conversationId },
        headers: getWidgetAuthHeaders(),
      })
      setMessages(page.messages)
      setHasMoreOlder(page.hasMore)
    } catch {
      /* keep current messages */
    }
  }, [conversationId])

  // Prepend an older page (keyset cursor = oldest loaded message id).
  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder || messages.length === 0) return
    setLoadingOlder(true)
    try {
      const page = await listChatMessagesFn({
        data: { conversationId, before: messages[0].id },
        headers: getWidgetAuthHeaders(),
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
  }, [conversationId, loadingOlder, messages])

  useChatStream({
    enabled: conversationId != null,
    resetKey: conversationId ?? '',
    buildUrl: async () => {
      if (!conversationId) return null
      try {
        const { token } = await mintChatStreamTokenFn({ headers: getWidgetAuthHeaders() })
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
          setAgentsOnline(true) // an agent is clearly here right now
        }
      } else if (evt.kind === 'typing' && evt.side === 'agent') {
        onRemoteTyping()
        setAgentsOnline(true)
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

  const submitCsat = useCallback(
    (rating: number) => {
      if (!conversationId) return
      setCsatSubmitted(true)
      void submitCsatFn({
        data: { conversationId, rating },
        headers: getWidgetAuthHeaders(),
      }).catch(() => setCsatSubmitted(false))
    },
    [conversationId]
  )

  // Prompt for a rating once the conversation is closed and not yet rated.
  const showCsatPrompt =
    !!conversationId &&
    conversationStatus === 'closed' &&
    csatRating == null &&
    !csatSubmitted &&
    messages.length > 0

  // Help-center deflection: as the visitor types their first message (before a
  // conversation exists), suggest relevant articles so they can self-serve.
  const [helpResults, setHelpResults] = useState<Array<{ slug: string; title: string }>>([])
  useEffect(() => {
    if (!helpEnabled || conversationId || messages.length > 0) {
      setHelpResults([])
      return
    }
    const q = input.trim()
    if (q.length < 3) {
      setHelpResults([])
      return
    }
    const controller = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/widget/kb-search?q=${encodeURIComponent(q)}&limit=3`, {
          signal: controller.signal,
        })
        if (!res.ok) return
        const json = (await res.json()) as {
          data?: { articles?: Array<{ slug: string; title: string }> }
        }
        setHelpResults(json.data?.articles ?? [])
      } catch {
        /* aborted or failed — leave suggestions as-is */
      }
    }, 300)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [input, helpEnabled, conversationId, messages.length])

  // The newest visitor message is "Seen" once the agent's read watermark
  // reaches it.
  const lastVisitorMessage = [...messages].reverse().find((m) => m.senderType === 'visitor')
  const lastVisitorSeen =
    !!agentReadAt &&
    !!lastVisitorMessage &&
    new Date(agentReadAt).getTime() >= new Date(lastVisitorMessage.createdAt).getTime()

  // Availability shown to the visitor: a live agent always counts as online;
  // when office hours are configured, the schedule also marks us available.
  const available = chatAvailable(agentsOnline, withinOfficeHours)

  // Pre-chat email: prompt only before the conversation starts, for anonymous
  // visitors, when configured. 'required' blocks sending until a valid address.
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim())
  const needsEmail =
    preChatMode !== 'off' && !emailKnown && !conversationId && messages.length === 0
  const emailBlocksSend = preChatMode === 'required' && needsEmail && !emailValid

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
        showCsat: showCsatPrompt || csatSubmitted || csatRating != null,
      }),
    [
      messages,
      hasMoreOlder,
      hasGreeting,
      showEmpty,
      lastVisitorSeen,
      remoteTyping,
      showCsatPrompt,
      csatSubmitted,
      csatRating,
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
    void markChatReadFn({ data: { conversationId }, headers: getWidgetAuthHeaders() }).catch(
      () => {}
    )
  }, [conversationId, lastMessageId])

  const send = useCallback(async () => {
    const text = input.trim()
    const attachments = pendingAttachments
    if ((!text && attachments.length === 0) || sending || uploading || emailBlocksSend) return
    setSending(true)
    setInput('')
    clearAttachments()

    const ready = await ensureSession()
    if (!ready) {
      setInput(text)
      setSending(false)
      return
    }
    try {
      const res = await sendChatMessageFn({
        data: {
          conversationId: conversationId ?? undefined,
          content: text,
          attachments: attachments.length > 0 ? attachments : undefined,
          // Attach the captured email on the first message only.
          visitorEmail: needsEmail && emailValid ? emailInput.trim() : undefined,
        },
        headers: getWidgetAuthHeaders(),
      })
      setConversationId(res.conversation.id as ConversationId)
      appendMessage(res.message)
      if (needsEmail && emailValid) setEmailKnown(true)
    } catch {
      setInput(text)
    } finally {
      setSending(false)
    }
  }, [
    input,
    pendingAttachments,
    sending,
    uploading,
    emailBlocksSend,
    needsEmail,
    emailValid,
    emailInput,
    conversationId,
    ensureSession,
    appendMessage,
    clearAttachments,
  ])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void send()
      }
    },
    [send]
  )

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
            side="agent"
            authorName={teamName ?? undefined}
            content={welcomeMessage ?? ''}
          />
        )
      case 'message': {
        const m = row.message
        return (
          <ChatBubble
            side={m.senderType === 'visitor' ? 'visitor' : 'agent'}
            authorName={
              m.senderType === 'agent' ? (m.author.displayName ?? teamName ?? undefined) : undefined
            }
            authorAvatar={m.senderType === 'agent' ? m.author.avatarUrl : null}
            content={m.content}
            attachments={m.attachments}
            time={formatTime(m.createdAt)}
          />
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
            {csatSubmitted || csatRating != null ? (
              <p className="text-xs text-muted-foreground">
                <FormattedMessage
                  id="widget.chat.csat.thanks"
                  defaultMessage="Thanks for your feedback!"
                />
              </p>
            ) : (
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
                      onClick={() => submitCsat(n)}
                      className="text-lg leading-none text-muted-foreground/50 hover:text-amber-500 transition-colors"
                      aria-label={`Rate ${n} of 5`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Presence strip */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 shrink-0">
        <span
          className={cn(
            'size-2 rounded-full',
            available ? 'bg-emerald-500' : 'bg-muted-foreground/40'
          )}
          aria-hidden
        />
        <span className="text-xs text-muted-foreground">
          {available ? (
            <FormattedMessage id="widget.chat.online" defaultMessage="We're online" />
          ) : (
            <FormattedMessage id="widget.chat.offline" defaultMessage="We'll reply by email" />
          )}
        </span>
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
                onClick={() => onArticleSelect?.(a.slug)}
                className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/20 px-2 py-1.5 text-left text-xs hover:bg-muted/40 transition-colors"
              >
                <BookOpenIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Offline hint */}
      {!available && offlineMessage && (
        <p className="px-4 pt-2 text-[11px] text-muted-foreground/70 text-center">
          {offlineMessage}
        </p>
      )}

      {/* Composer */}
      <div className="border-t border-border/40 p-2 shrink-0">
        {/* Pre-chat email capture (anonymous visitors). */}
        {needsEmail && (
          <div className="px-1 pb-2">
            <label
              htmlFor="widget-chat-email"
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
              id="widget-chat-email"
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        )}
        {/* Pending attachment previews */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">
            {pendingAttachments.map((a, i) => (
              <div
                key={i}
                className="group relative flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-1.5 py-1 text-[11px]"
              >
                <PaperClipIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="max-w-[120px] truncate">{a.name || 'file'}</span>
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
        <div className="flex items-end gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-primary/20">
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
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="shrink-0 flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            aria-label={intl.formatMessage({
              id: 'widget.chat.attach',
              defaultMessage: 'Attach image',
            })}
          >
            <PaperClipIcon className="w-4 h-4" />
          </button>
          <EmojiPicker onSelect={(emoji) => setInput((prev) => prev + emoji)} />
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              onLocalInput()
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={intl.formatMessage({
              id: 'widget.chat.placeholder',
              defaultMessage: 'Type your message…',
            })}
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none max-h-24 py-1"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={
              (!input.trim() && pendingAttachments.length === 0) ||
              sending ||
              uploading ||
              emailBlocksSend
            }
            className="shrink-0 flex items-center justify-center size-7 rounded-md bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
            aria-label={intl.formatMessage({ id: 'widget.chat.send', defaultMessage: 'Send' })}
          >
            <PaperAirplaneIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

interface ChatBubbleProps {
  side: 'visitor' | 'agent'
  content: string
  authorName?: string
  authorAvatar?: string | null
  attachments?: ChatAttachment[]
  time?: string
}

function ChatBubble({
  side,
  content,
  authorName,
  authorAvatar,
  attachments,
  time,
}: ChatBubbleProps) {
  const isVisitor = side === 'visitor'
  return (
    <div className={cn('flex items-end gap-2', isVisitor ? 'flex-row-reverse' : 'flex-row')}>
      {!isVisitor && (
        <Avatar
          src={authorAvatar ?? null}
          name={authorName ?? 'Support'}
          className="size-6 text-[10px] shrink-0"
        />
      )}
      <div className={cn('flex flex-col max-w-[78%]', isVisitor ? 'items-end' : 'items-start')}>
        {!isVisitor && authorName && (
          <span className="text-[10px] text-muted-foreground/60 mb-0.5 px-1">{authorName}</span>
        )}
        {content && (
          <div
            className={cn(
              'rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words leading-relaxed',
              isVisitor
                ? 'bg-primary text-primary-foreground rounded-br-md'
                : 'bg-muted text-foreground rounded-bl-md'
            )}
          >
            {content}
          </div>
        )}
        {attachments && attachments.length > 0 && <ChatAttachmentList attachments={attachments} />}
        {time && <span className="text-[10px] text-muted-foreground/50 mt-0.5 px-1">{time}</span>}
      </div>
    </div>
  )
}
