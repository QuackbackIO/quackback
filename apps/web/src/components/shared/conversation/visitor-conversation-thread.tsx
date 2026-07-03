import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { buildConversationRows, type ConversationRow } from './conversation-rows'
import { AssistantWorkingTrace, AssistantStreamingBubble } from './assistant-turn'
import { ConversationPresenceBadge } from './conversation-presence-badge'
import { conversationAvailable } from '@/lib/shared/conversation/presence'
import { ArrowUpIcon, ChevronDownIcon } from '@heroicons/react/24/solid'
import { ChatBubbleLeftRightIcon, PaperClipIcon, BookOpenIcon } from '@heroicons/react/24/outline'
import type { ConversationId } from '@quackback/ids'
import { Avatar } from '@/components/ui/avatar'
import { TypingDots } from '@/components/shared/typing-dots'
import { EmojiPicker } from '@/components/shared/emoji-picker'
import { personalizeMessage, firstNameOf } from '@/lib/shared/conversation/personalize'
import { useConversationStream } from '@/lib/client/hooks/use-conversation-stream'
import { useConversationTyping } from '@/lib/client/hooks/use-conversation-typing'
import { useAssistantTurn } from '@/lib/client/hooks/use-assistant-turn'
import { useConversationComposerAttachments } from '@/lib/client/hooks/use-conversation-composer-attachments'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { ComposerAttachmentTray } from '@/components/shared/composer-attachment-tray'
import {
  ConversationRichComposer,
  type ConversationRichComposerHandle,
} from '@/components/admin/conversation/conversation-rich-composer'
import { VisitorMessageBubble } from '@/components/conversation/message-bubble'
import {
  ThreadViewport,
  docHasContentNode,
  useComposerDoc,
  useMarkReadOnIncoming,
  useOlderMessages,
  useThreadVirtualizer,
  useTypingSender,
} from '@/components/conversation/thread'
import {
  applyVisitorThreadEvent,
  appendSentVisitorMessage,
  prependOlderVisitorMessages,
  type VisitorThreadCache,
} from '@/components/conversation/events-reducer'
import { conversationKeys } from '@/components/conversation/query-keys'
import type { EmbedOpenMode } from '@/components/shared/quackback-embed-card'
import { LinkPreviews } from '@/components/shared/link-preview-card'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import {
  getMyConversationFn,
  sendConversationMessageFn,
  listConversationMessagesFn,
  mintConversationStreamTokenFn,
  submitCsatFn,
} from '@/lib/server/functions/conversation'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const NO_HEADERS = (): Record<string, string> => ({})
const ALWAYS_READY = async (): Promise<boolean> => true
const EMPTY_MESSAGES: ConversationMessageDTO[] = []

export interface VisitorConversationThreadPresence {
  agentsOnline: boolean
  withinOfficeHours: boolean | null
  nextOpenAt: string | null
}

export interface VisitorConversationThreadProps {
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
  presence: VisitorConversationThreadPresence
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
  /** Render the built-in header row (assistant identity / presence strip).
   *  The widget passes false — its shell shows the same content in the top
   *  bar beside the back button, keeping one header row like the reference
   *  messengers. The portal keeps the built-in row. */
  showHeader?: boolean
  /** Notified when the first send creates the conversation. */
  onConversationStarted?: (id: ConversationId) => void
}

/**
 * The visitor side of a conversation: virtualized thread, live SSE updates,
 * composer (rich text + image attachments + emoji), pre-chat email capture,
 * presence strip, offline hints, and the post-conversation CSAT prompt.
 *
 * Shared by the widget messenger tab and the portal Support tab — every
 * surface-specific dependency (auth headers, session minting, presence,
 * uploads, help search) comes in through props. Built on the shared thread
 * core (components/conversation): the message model lives in the query cache
 * and stream events apply through the pure events reducer.
 */
export function VisitorConversationThread({
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
  showHeader = true,
  onConversationStarted,
}: VisitorConversationThreadProps) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const firstName = firstNameOf(currentUser?.name)

  const [loading, setLoading] = useState(true)
  const [conversationId, setConversationId] = useState<ConversationId | null>(null)
  // The conversation the FIRST send created. A fresh visitor's first send
  // mints their anonymous session, which bumps sessionVersion and re-runs the
  // load effect; for a 'new' target that reload would reset to the greeting
  // state and wipe the just-sent message. Remembering the created id lets the
  // reload fetch the real thread instead.
  const createdConversationIdRef = useRef<ConversationId | null>(null)
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null)
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null)
  const [teamName, setTeamName] = useState<string | null>(null)
  // AI-assistant display identity (fronts new conversations); null when disabled.
  const [assistant, setAssistant] = useState<{ name: string; avatarUrl: string | null } | null>(
    null
  )
  // Pre-chat email capture (anonymous visitors). Data-driven: identified
  // visitors come back with visitorHasEmail=true, so the prompt never shows.
  // Whether an offline reply could actually reach this visitor by email — drives
  // the offline copy so the surface never promises email it can't send.
  const [canEmailReply, setCanEmailReply] = useState(false)
  // Whether the visitor rated in THIS session — enables the optional comment
  // follow-up. A returning, already-rated visitor goes straight to "thanks".
  const [csatJustRated, setCsatJustRated] = useState(false)
  const [csatCommentDone, setCsatCommentDone] = useState(false)
  const [csatComment, setCsatComment] = useState('')
  // Composer is a rich TipTap doc (inline images + post embeds): the shared
  // composer-doc state (plain text gates send + drives help-search/typing; the
  // doc persists as contentJson; the reset signal clears the editor on send).
  const composer = useComposerDoc()
  const [sending, setSending] = useState(false)

  const scrollViewportRef = useRef<HTMLDivElement>(null)
  // Monotonic CSAT submit counter: a later submit (comment) bumps it so a stale
  // rating-request failure can't roll back state the visitor has moved past.
  const csatSubmitGenRef = useRef(0)

  // The thread's message model lives in the query cache (written by the load
  // below + the reducer): messages, backfill cursor, the agent read watermark,
  // status, and CSAT. A skipToken query subscribes without ever fetching.
  const { data: thread } = useQuery<VisitorThreadCache>({
    queryKey: conversationKeys.visitorThread(conversationId),
    queryFn: skipToken,
    staleTime: Infinity,
  })
  const messages = thread?.messages ?? EMPTY_MESSAGES
  const hasMoreOlder = thread?.hasMore ?? false
  const agentReadAt = thread?.agentLastReadAt ?? null
  const conversationStatus = thread?.status ?? null
  const csatRating = thread?.csatRating ?? null

  const sendTyping = useTypingSender(conversationId, getAuthHeaders)
  const { remoteTyping, onLocalInput, onRemoteTyping, clearRemoteTyping } =
    useConversationTyping(sendTyping)
  const {
    assistantActivity,
    assistantStream,
    onAssistantActivity,
    onAssistantDelta,
    clearAssistantTurn,
  } = useAssistantTurn()

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
  } = useConversationComposerAttachments(upload)
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
            id: 'widget.messenger.upload.failed',
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
  const debouncedMessageText = useDebouncedValue(composer.text, 500)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<ConversationRichComposerHandle>(null)

  // Initial load — resumes an existing conversation for the current principal
  // (works without forcing a session: getMyConversationFn returns just the greeting when
  // there's no session yet). Re-keyed on sessionVersion so it reloads after
  // identify swaps the actor.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // 'new' → null (blank greeting) until the first send creates a thread,
        // then that thread; an id → that thread; undefined → active.
        const effectiveTarget =
          conversationTarget === 'new'
            ? (createdConversationIdRef.current ?? null)
            : (conversationTarget ?? undefined)
        const res = await getMyConversationFn({
          data: { conversationId: effectiveTarget },
          headers: getAuthHeaders(),
        })
        if (cancelled) return
        // A 'new'-target reload can race the first send (minting the anonymous
        // session bumps sessionVersion mid-send): if the send has created a
        // thread meanwhile, drop this stale greeting-only response instead of
        // wiping the just-sent message — the send path owns the state.
        if (!res.conversation && createdConversationIdRef.current) return
        setWelcomeMessage(res.welcomeMessage)
        setOfflineMessage(res.offlineMessage)
        setTeamName(res.teamName)
        setAssistant(res.assistant ?? null)
        setCanEmailReply(res.canEmailVisitor)
        const conv = res.conversation
        if (conv) {
          // Snapshot the thread into the query cache; stream events and sends
          // apply on top of it through the events reducer.
          queryClient.setQueryData(conversationKeys.visitorThread(conv.id as ConversationId), {
            messages: res.messages,
            hasMore: res.hasMore,
            agentLastReadAt: conv.agentLastReadAt ?? null,
            status: conv.status ?? null,
            csatRating: conv.csatRating ?? null,
          } satisfies VisitorThreadCache)
        }
        setConversationId((conv?.id as ConversationId | undefined) ?? null)
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
      queryClient.setQueryData(
        conversationKeys.visitorThread(conversationId),
        (prev: VisitorThreadCache | undefined) =>
          prev
            ? { ...prev, messages: page.messages, hasMore: page.hasMore }
            : {
                messages: page.messages,
                hasMore: page.hasMore,
                agentLastReadAt: null,
                status: null,
                csatRating: null,
              }
      )
    } catch {
      /* keep current messages */
    }
  }, [conversationId, getAuthHeaders, queryClient])

  // Prepend an older page (keyset cursor = oldest loaded message id).
  const { loadingOlder, loadOlder } = useOlderMessages({
    conversationId,
    messages,
    getHeaders: getAuthHeaders,
    onPage: (page) => {
      if (!conversationId) return
      queryClient.setQueryData(
        conversationKeys.visitorThread(conversationId),
        (prev: VisitorThreadCache | undefined) => prependOlderVisitorMessages(prev, page)
      )
    },
  })

  useConversationStream({
    enabled: conversationId != null,
    resetKey: conversationId ?? '',
    buildUrl: async () => {
      if (!conversationId) return null
      try {
        const { token } = await mintConversationStreamTokenFn({ headers: getAuthHeaders() })
        if (!token) return null
        return `/api/chat/stream?conversationId=${encodeURIComponent(
          conversationId
        )}&token=${encodeURIComponent(token)}`
      } catch {
        return null
      }
    },
    onEvent: (evt) => {
      // Cache-shaped updates (message/read/deleted/conversation) route through
      // the pure reducer; typing + presence side effects stay here.
      if (conversationId) {
        queryClient.setQueryData(
          conversationKeys.visitorThread(conversationId),
          (prev: VisitorThreadCache | undefined) =>
            applyVisitorThreadEvent(prev, evt, conversationId)
        )
      }
      if (evt.kind === 'message' && evt.message.senderType === 'agent') {
        clearRemoteTyping()
        clearAssistantTurn() // the persisted reply replaces the live trace/stream
        onAgentActivity?.() // an agent is clearly here right now
      } else if (evt.kind === 'typing' && evt.side === 'agent') {
        onRemoteTyping()
        onAgentActivity?.()
      } else if (evt.kind === 'assistant_activity') {
        onAssistantActivity(evt.status)
      } else if (evt.kind === 'assistant_delta') {
        onAssistantDelta(evt.text)
      }
    },
    onReconnect: () => void refreshMessages(),
  })

  // Ephemeral turn state is component-local (not keyed by resetKey); drop it when
  // switching threads so it can't bleed across conversations.
  useEffect(() => clearAssistantTurn, [conversationId, clearAssistantTurn])

  // A star click records the rating immediately (so it's never lost), then the
  // surface offers an optional comment as a follow-up.
  const submitRating = useCallback(
    (rating: number) => {
      if (!conversationId) return
      const gen = ++csatSubmitGenRef.current
      const setRating = (value: number | null) =>
        queryClient.setQueryData(
          conversationKeys.visitorThread(conversationId),
          (prev: VisitorThreadCache | undefined) => (prev ? { ...prev, csatRating: value } : prev)
        )
      setRating(rating)
      setCsatJustRated(true)
      void submitCsatFn({
        data: { conversationId, rating },
        headers: getAuthHeaders(),
      }).catch(() => {
        // Roll back so the stars reappear for a retry — unless a later CSAT
        // submit (e.g. the comment) already superseded this request.
        if (csatSubmitGenRef.current === gen) {
          setRating(null)
          setCsatJustRated(false)
        }
      })
    },
    [conversationId, getAuthHeaders, queryClient]
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
  const messageText = composer.text
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
  const available = conversationAvailable(presence.agentsOnline, presence.withinOfficeHours)

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

  // Show the offline hint when the team is away. When we can email a reply, only
  // echo the admin's message if one is set; when we can't, always show the
  // neutral "we'll reply here" note instead of a false email promise. With the
  // assistant fronting the conversation there is no "away" — it is always
  // available, so the hint is suppressed entirely; availability only becomes
  // relevant again when the assistant hands off to a human (future).
  const showOfflineHint =
    !assistant && !available && (canEmailReply ? Boolean(offlineMessage) : true)

  // Flatten the thread into virtualized rows. anchorTo:'end' + followOnAppend
  // keep the view pinned to the newest message and stick to the bottom as
  // messages stream in; getItemKey (message id) lets the virtualizer hold the
  // viewport when older history is prepended.
  const hasGreeting = !hasMoreOlder && !!welcomeMessage
  const showEmpty = !loading && messages.length === 0 && !welcomeMessage
  const rows = useMemo(
    () =>
      buildConversationRows({
        messages,
        hasMoreOlder,
        hasGreeting,
        showEmpty,
        showSeen: lastVisitorSeen && !remoteTyping,
        showTyping: remoteTyping,
        assistantActivity,
        assistantStream,
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
      assistantActivity,
      assistantStream,
      showCsatPrompt,
      csatRating,
      conversationStatus,
    ]
  )

  const virtualizer = useThreadVirtualizer({
    rows,
    scrollRef: scrollViewportRef,
    estimateSize: 64,
    loading,
  })

  // Clear unread on the visitor side only when the newest message is from an
  // agent — skip the visitor's own outbound sends (avoids a write + 'read'
  // broadcast on every send).
  useMarkReadOnIncoming({
    conversationId,
    messages,
    whenLastFrom: 'agent',
    getHeaders: getAuthHeaders,
  })

  const send = useCallback(async () => {
    const text = composer.text.trim()
    const doc = composer.docRef.current
    const hasAttachments = pendingAttachments.length > 0
    // Sendable when there's typed text, an inline embed, or a tray attachment.
    if ((!text && !docHasContentNode(doc) && !hasAttachments) || sending || uploading) return
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
        },
        headers: getAuthHeaders(),
      })
      const isNewConversation = !conversationId
      const newId = res.conversation.id as ConversationId
      createdConversationIdRef.current = newId
      setConversationId(newId)
      // The reducer initializes the cache on a first send, dedupes the append,
      // and adopts the server's status so a reply that reopens a closed thread
      // clears the "closed / reply to reopen" hint (and its CSAT prompt).
      queryClient.setQueryData(
        conversationKeys.visitorThread(newId),
        (prev: VisitorThreadCache | undefined) => appendSentVisitorMessage(prev, res)
      )
      if (isNewConversation) {
        onConversationStarted?.(newId)
      }
      // Clear the composer only on success — the resetSignal bump empties the editor.
      composer.clear()
      clearAttachments()
      setUploadError(null)
    } catch {
      // Leave the composer content intact for a retry.
    } finally {
      setSending(false)
    }
  }, [
    composer,
    sending,
    conversationId,
    ensureSession,
    pendingAttachments,
    uploading,
    clearAttachments,
    getAuthHeaders,
    onConversationStarted,
    queryClient,
  ])

  const renderRow = (row: ConversationRow) => {
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
                <FormattedMessage id="widget.messenger.loadingOlder" defaultMessage="Loading…" />
              ) : (
                <FormattedMessage
                  id="widget.messenger.loadOlder"
                  defaultMessage="Load earlier messages"
                />
              )}
            </button>
          </div>
        )
      case 'greeting':
        // The assistant fronts the greeting when enabled; the team name
        // otherwise. Identity only — replies still come from the team.
        return (
          <VisitorMessageBubble
            side="peer"
            authorName={assistant?.name ?? teamName ?? undefined}
            isAssistant={!!assistant}
            content={personalizeMessage(welcomeMessage ?? '', firstName)}
            embedOpenMode={embedOpenMode}
          />
        )
      case 'message': {
        const m = row.message
        const isVisitor = m.senderType === 'visitor'
        return (
          <VisitorMessageBubble
            side={isVisitor ? 'self' : 'peer'}
            authorName={isVisitor ? undefined : (m.author?.displayName ?? teamName ?? undefined)}
            isAssistant={m.isAssistant}
            content={m.content}
            contentJson={m.contentJson}
            attachments={m.attachments}
            citations={m.citations}
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
            <FormattedMessage
              id="widget.messenger.system.ended"
              defaultMessage="Conversation ended"
            />
          ) : event?.kind === 'chat_reopened' ? (
            <FormattedMessage
              id="widget.messenger.system.reopened"
              defaultMessage="Conversation reopened"
            />
          ) : event?.kind === 'assigned' ? (
            <FormattedMessage
              id="widget.messenger.system.assigned"
              defaultMessage="Assigned to {name}"
              values={{ name: event.agentName ?? 'an agent' }}
            />
          ) : event?.kind === 'assistant_handoff' ? (
            <FormattedMessage
              id="widget.messenger.system.handoff"
              defaultMessage="Connecting you to the team"
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
                id="widget.messenger.startPrompt"
                defaultMessage="Send us a message and we'll get back to you."
              />
            </p>
          </div>
        )
      case 'seen':
        return (
          <p className="text-end text-[10px] text-muted-foreground/50 pe-1">
            <FormattedMessage id="widget.messenger.seen" defaultMessage="Seen" />
          </p>
        )
      case 'typing':
        // Dots-only bubble, matching the messenger bubble language.
        return (
          <div className="flex">
            <div className="rounded-2xl bg-muted px-4 py-3">
              <TypingDots />
            </div>
          </div>
        )
      case 'assistant-activity':
        // Quinn's live working trace (thinking → searching the knowledge base).
        return <AssistantWorkingTrace status={row.status} />
      case 'assistant-stream':
        // Quinn's answer as it streams, before the persisted message lands.
        return <AssistantStreamingBubble text={row.text} />

      case 'csat':
        return (
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 text-center">
            {csatRating == null ? (
              // Step 1: rate. A click records the rating right away.
              <>
                <p className="mb-1.5 text-xs text-muted-foreground">
                  <FormattedMessage
                    id="widget.messenger.csat.prompt"
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
                    id="widget.messenger.csat.commentPrompt"
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
                    id: 'widget.messenger.csat.commentPlaceholder',
                    defaultMessage: 'Add a comment (optional)',
                  })}
                  placeholder={intl.formatMessage({
                    id: 'widget.messenger.csat.commentPlaceholder',
                    defaultMessage: 'Add a comment (optional)',
                  })}
                  className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={submitComment}
                  className="self-center rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <FormattedMessage
                    id="widget.messenger.csat.send"
                    defaultMessage="Send feedback"
                  />
                </button>
              </div>
            ) : (
              // Final state: commented, or a returning already-rated visitor.
              <p className="text-xs text-muted-foreground">
                <FormattedMessage
                  id="widget.messenger.csat.thanks"
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
      {/* Header: with the assistant enabled the thread is always fronted by its
          identity — the AI is always available, so no availability promise is
          made at any point (matching the AI-first messenger model). Without an
          assistant, the classic live presence strip shows. */}
      {showHeader && assistant ? (
        <div className="flex items-center gap-2.5 px-4 py-2 border-b border-border/40 shrink-0">
          <Avatar src={assistant.avatarUrl} name={assistant.name} className="size-7 text-[10px]" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight text-foreground">{assistant.name}</p>
            <p className="text-[11px] leading-tight text-muted-foreground">
              <FormattedMessage
                id="widget.messenger.assistant.teamAlso"
                defaultMessage="The team can also help"
              />
            </p>
          </div>
        </div>
      ) : showHeader ? (
        <div className="flex items-center px-4 py-2 border-b border-border/40 shrink-0">
          <ConversationPresenceBadge available={available} />
        </div>
      ) : null}

      <div className="relative flex-1 min-h-0">
        <ThreadViewport
          virtualizer={virtualizer}
          rows={rows}
          renderRow={renderRow}
          viewportRef={scrollViewportRef}
          scrollBarClassName="w-1.5"
          className="h-full"
          rowClassName="px-3 py-1.5"
        />

        {/* Jump to latest — shown only when the visitor has scrolled up to read
            history (followOnAppend keeps the view pinned when already at end). */}
        {!virtualizer.isAtEnd() && (
          <button
            type="button"
            onClick={() => virtualizer.scrollToEnd({ behavior: 'smooth' })}
            aria-label={intl.formatMessage({
              id: 'widget.messenger.jumpToLatest',
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
              id="widget.messenger.suggestedArticles"
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
                id="widget.messenger.offline.noEmail"
                defaultMessage="We're away right now. Leave a message and we'll reply here when we're back."
              />
            )}
          </p>
          {reopenLabel && (
            <p className="mt-0.5">
              <FormattedMessage
                id="widget.messenger.offline.backAt"
                defaultMessage="Back {when}"
                values={{ when: reopenLabel }}
              />
            </p>
          )}
        </div>
      )}

      {/* Composer is always available. A closed thread reopens on the next send,
          so we keep the composer and only hint at the state. */}
      {conversationStatus === 'closed' && (
        <div className="flex items-center gap-2 px-3 pt-2" role="status">
          <span className="h-px flex-1 bg-border/50" />
          <span className="text-center text-[11px] text-muted-foreground">
            <FormattedMessage
              id="widget.messenger.closedReopen"
              defaultMessage="This conversation was closed. Reply to reopen it."
            />
          </span>
          <span className="h-px flex-1 bg-border/50" />
        </div>
      )}
      <div className="border-t border-border/40 p-2 shrink-0">
        {/* Composer: a rich editor on top (inline images via paste/drop +
              the attach button, and post links become embed cards), actions
              (attach / emoji / send) on the row below. Enter sends; Shift+Enter
              inserts a newline and the editor auto-grows to fit. */}
        <div className="rounded-2xl border border-border bg-background px-3 py-2.5 shadow-sm transition-shadow focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-primary/25">
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
          <ConversationRichComposer
            ref={composerRef}
            resetSignal={composer.resetSignal}
            disabled={sending}
            placeholder={intl.formatMessage({
              id: 'widget.messenger.placeholder',
              defaultMessage: 'Type your message…',
            })}
            onChange={composer.onChange}
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
                id: 'widget.messenger.attach',
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
                (!composer.text.trim() &&
                  !composer.hasContentNode &&
                  pendingAttachments.length === 0) ||
                sending ||
                uploading
              }
              className="shrink-0 flex items-center justify-center size-9 rounded-full bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
              aria-label={intl.formatMessage({
                id: 'widget.messenger.send',
                defaultMessage: 'Send',
              })}
            >
              <ArrowUpIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
