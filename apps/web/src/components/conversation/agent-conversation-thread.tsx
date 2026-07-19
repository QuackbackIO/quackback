/**
 * The unified agent-facing thread (UNIFIED-INBOX-SPEC.md §2.5): one container
 * for both a conversation and a ticket, built on the shared thread core
 * (thread.tsx) + AgentMessageBubble + the events reducer. A `ThreadCapabilities`
 * object (thread-capabilities.ts), derived from `item.kind` (and a ticket's
 * `type`), gates every conversation-only extra — macros, CSAT, typing, convert-
 * to-post, end-conversation, link previews, inbox translation, deep-link jump,
 * the composer's emoji picker — while the inbox message actions (reactions,
 * flags, mark-unread, delete) and the reply/note composer stay on for both
 * kinds (a back_office/tracker ticket forces note-only). The conversation path
 * is unchanged data-wise (same queries/mutations/caches as before the fold);
 * the ticket path is new, mirroring it one-for-one against the ticket domain's
 * equivalents. The route keeps the list/nav chrome, the inbox SSE wiring, and
 * (until M5) the ticket-only detail panel rendered beside this component.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouteContext } from '@tanstack/react-router'
import {
  PaperAirplaneIcon,
  PaperClipIcon,
  PencilSquareIcon,
  ChevronLeftIcon,
  ChevronDownIcon,
  EllipsisHorizontalIcon,
  LanguageIcon,
  XMarkIcon,
  CheckIcon,
  BookmarkIcon as BookmarkSolidIcon,
} from '@heroicons/react/24/solid'
import {
  ChatBubbleLeftRightIcon,
  BookmarkIcon,
  MoonIcon,
  TicketIcon,
  NoSymbolIcon,
  LinkIcon,
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type {
  ConversationId,
  ConversationMessageId,
  TicketId,
  TicketStatusId,
} from '@quackback/ids'
import {
  sendAgentMessageFn,
  addConversationNoteFn,
  deleteConversationMessageFn,
  addMessageReactionFn,
  removeMessageReactionFn,
  setMessageFlagFn,
  markConversationUnreadFromMessageFn,
  exportConversationTranscriptFn,
  snoozeConversationFn,
  setConversationStatusFn,
} from '@/lib/server/functions/conversation'
import { isMissingRequiredAttributesMessage } from '@/lib/shared/conversation/attribute-values'
import {
  sendTicketMessageFn,
  addTicketNoteFn,
  listTicketMessagesFn,
  markTicketUnreadFromMessageFn,
  markTicketReadFn,
  setTicketStatusFn,
  exportTicketTranscriptFn,
} from '@/lib/server/functions/tickets'
import { blockPersonFn, unblockPersonFn } from '@/lib/server/functions/blocking'
import { useInboxTranslation } from '@/lib/client/hooks/use-inbox-translation'
import {
  isTranslationUnavailableMessage,
  isTranslationRichContentMessage,
} from '@/lib/shared/conversation/translation'
import { removeConversationSlaFn } from '@/lib/server/functions/sla'
import type {
  ConversationAttachment,
  ConversationMessageDTO,
  AgentConversationMessageDTO,
  ConversationDTO,
} from '@/lib/shared/conversation/types'
import type { InboxItemRef, LinkedTicketSummary } from '@/lib/shared/inbox/items'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import {
  formatTicketNumber,
  resolveDefaultClosedStatusId,
  resolveResolvedStatusId,
} from '@/lib/shared/tickets'
import { AgentMessageBubble, UnreadDivider } from '@/components/conversation/message-bubble'
import { computeBlockStates } from '@/components/shared/conversation/conversation-rows'
import {
  ThreadViewport,
  useMarkReadOnIncoming,
  useOlderMessages,
  useThreadVirtualizer,
  useTypingSender,
} from '@/components/conversation/thread'
import {
  appendSentAgentMessage,
  appendSentTicketMessage,
  prependOlderAgentMessages,
  prependOlderTicketMessages,
  removeAgentThreadMessage,
  removeTicketThreadMessage,
  toggleReactionLocal,
  updateAgentThreadMessage,
  updateTicketThreadMessage,
  type AgentThreadCache,
  type TicketThreadCache,
} from '@/components/conversation/events-reducer'
import {
  CONVERSATION_CAPABILITIES,
  ticketCapabilities,
  type ThreadCapabilities,
} from '@/components/conversation/thread-capabilities'
import { conversationKeys } from '@/components/conversation/query-keys'
import { MacroPicker } from '@/components/conversation/macro-picker'
import { WorkflowRunPicker } from '@/components/conversation/workflow-run-picker'
import { PriorityControl } from '@/components/admin/conversation/priority-control'
import { AssigneeControl } from '@/components/admin/conversation/assignee-control'
import { ChannelBadge } from '@/components/admin/conversation/channel-badge'
import { SlaChip } from '@/components/admin/conversation/sla-chip'
import { ConversationTagsEditor } from '@/components/admin/conversation/conversation-tags-editor'
import { StatusControl } from '@/components/admin/conversation/status-control'
import { TicketTypeBadge, TicketStageChip } from '@/components/admin/inbox/ticket-chips'
import {
  TicketStatusControl,
  TicketAssigneeControl,
  TicketPriorityControl,
} from '@/components/admin/inbox/ticket-controls'
import { InboxDetailPanel } from '@/components/admin/inbox/inbox-detail-panel'
import { CreateTicketDialog } from '@/components/admin/inbox/create-ticket-dialog'
import { ConvertToPostDialog } from '@/components/admin/conversation/convert-to-post-dialog'
import { EndConversationDialog } from '@/components/admin/conversation/end-conversation-dialog'
import { SharePostDialog } from '@/components/admin/conversation/share-post-dialog'
import { usePersonBlockStatus } from '@/components/admin/users/block-person-control'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { RequiredAttributesDialog } from '@/components/admin/conversation/required-attributes-dialog'
import { downloadTranscriptFile } from '@/components/admin/conversation/export-transcript-button'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import {
  CONVERSATION_EDITOR_FEATURES,
  CONVERSATION_NOTE_FEATURES,
} from '@/components/conversation/conversation-editor-features'
import { ComposerAttachmentTray } from '@/components/shared/composer-attachment-tray'
import { LinkPreviews } from '@/components/shared/link-preview-card'
import { conversationInboxQueries } from '@/lib/client/queries/conversation-inbox'
import { inboxQueries, ticketKeys, ticketQueries } from '@/lib/client/queries/inbox'
import { useSetTicketStatus } from '@/lib/client/mutations/inbox'
import {
  buildAdminConversationRows,
  type AdminConversationRow,
} from '@/lib/client/conversation/admin-conversation-rows'
import type { JSONContent } from '@tiptap/core'
import type { TiptapContent } from '@/lib/shared/db-types'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { useConversationTyping } from '@/lib/client/hooks/use-conversation-typing'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
import { useConversationComposerAttachments } from '@/lib/client/hooks/use-conversation-composer-attachments'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { useCopilotInsert } from '@/lib/client/hooks/use-copilot-insert'
import {
  EMPTY_DRAFT,
  answerToDraft,
  appendAnswerToDraft,
  appendTextToDraft,
  type ComposerDraft,
} from './composer-draft'
import { SuggestedReplyCard } from './suggested-reply-card'
import { ComposerAiActions, type ComposerMode } from './composer-ai-actions'
import { TypingDots } from '@/components/shared/typing-dots'
import { EmojiPicker } from '@/components/shared/emoji-picker'
import { Avatar } from '@/components/ui/avatar'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, tomorrowAt, inHours, nextMondayAt } from '@/lib/shared/utils'
import type { FeatureFlags } from '@/lib/shared/types/settings'

// "Jump to message" tuning: how long the flash plays (must match the
// flash-highlight keyframe duration) and how many older pages we'll auto-pull
// chasing a deep-linked message before giving up. Conversation-only
// (`capabilities.deepLinkJump`) — a ticket selection never carries a `?m=`.
const FLASH_MS = 2200
const MAX_JUMP_PAGES = 20

// Placeholder ids for the query that isn't active for the current item kind —
// `enabled: false` means the query never runs, so these never reach the
// server; they only exist to satisfy the branded-id parameter types.
const INACTIVE_CONVERSATION_ID = '' as ConversationId
const INACTIVE_TICKET_ID = '' as TicketId

export function AgentConversationThread({
  item,
  targetMessageId,
  onChanged,
  onBack,
  onSelectItem,
  onOpenPost,
  isVisitorTyping,
  isOtherAgentTyping,
  createTicketToken,
  openCopilotToken,
  requestOpenCopilot,
}: {
  /** The open item, discriminated by kind — drives both the data adapter and
   *  the derived `ThreadCapabilities`. */
  item: InboxItemRef
  /** Deep-link target: scroll to + flash this message once it's loaded.
   *  Conversation-only (`capabilities.deepLinkJump`). */
  targetMessageId: ConversationMessageId | null
  onChanged: () => void
  /** Mobile-only: return to the list (single-column layout). */
  onBack: () => void
  /** Navigate to another item — a previous conversation from the detail
   *  panel's contact card, or a linked ticket/conversation row. A bare
   *  TypeID, either kind (the route's `setSelectedId` resolves it). */
  onSelectItem: (id: string) => void
  /** Open an embedded post in the host's in-place `?post=` modal (the route owns
   *  the search-param navigation so the agent never leaves the thread). */
  onOpenPost: (postId: string) => void
  isVisitorTyping: boolean
  isOtherAgentTyping: boolean
  /** Bumped by the route's command-bar `create_ticket` action while this
   *  conversation is the active item (unified inbox §M5) — a change opens
   *  this thread's own create-ticket dialog (which needs the conversation
   *  data only this component has loaded). Ignored for a ticket item. */
  createTicketToken?: number
  /** Bumped by the route's Ask Copilot action (keyboard/command bar) —
   *  forwarded UNTOUCHED to the detail panel, which switches to its Copilot
   *  tab and focuses the ask input (and reads 0 as "no pending bump", the
   *  route's own reset sentinel). Both item kinds. */
  openCopilotToken?: number
  /** Ask the route to bump `openCopilotToken` — the route owns that signal,
   *  so every opener (the suggested-reply card's quiet "Ask Copilot" link
   *  here, the route's own keyboard/command-bar action) funnels through one
   *  counter instead of this component merging parallel ones. The route only
   *  passes it while Copilot is actually openable (`copilotAvailable`: tab
   *  gate + the ≥xl viewport that renders the detail panel); absent, the
   *  card hides its Ask Copilot link rather than rendering a dead one. */
  requestOpenCopilot?: () => void
}) {
  const queryClient = useQueryClient()
  const isTicket = item.kind === 'ticket'
  const conversationId = item.kind === 'conversation' ? item.id : null
  const ticketId = item.kind === 'ticket' ? item.id : null
  const threadKey = conversationKeys.agentThread(conversationId ?? INACTIVE_CONVERSATION_ID)
  const ticketThreadKey = ticketKeys.thread(ticketId ?? INACTIVE_TICKET_ID)
  // The current agent's display name, for attributing optimistic reactions.
  const { session, settings } = useRouteContext({ from: '__root__' })
  const myName = session?.user?.name ?? 'You'
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const showTickets = flags?.supportTickets ?? false

  // Reply and Note each hold an independent draft (the rich doc persisted as
  // contentJson + its markdown mirror), so toggling modes preserves each mode's
  // in-progress text/images. Both render the SAME unified RichTextEditor — reply
  // gets mentions on (agent surface), note is the team-internal preset. The
  // per-mode remount key force-remounts the active editor to clear it after a
  // send (an empty controlled value leaves a stale `<p></p>` that traps the
  // cursor) and to re-seed + focus after a text insert.
  const [noteMode, setNoteMode] = useState(false)
  const [replyDraft, setReplyDraft] = useState<ComposerDraft>(EMPTY_DRAFT)
  const [noteDraft, setNoteDraft] = useState<ComposerDraft>(EMPTY_DRAFT)
  const [replyKey, setReplyKey] = useState(0)
  const [noteKey, setNoteKey] = useState(0)
  // Latest drafts for stable, pull-based composer AI actions. Reading from
  // refs lets an async transform verify that the draft did not change without
  // recreating its callbacks on every keystroke.
  const replyDraftRef = useRef(replyDraft)
  replyDraftRef.current = replyDraft
  const noteDraftRef = useRef(noteDraft)
  noteDraftRef.current = noteDraft
  const scrollRef = useRef<HTMLDivElement>(null)

  // The one controlled convert dialog's seed, built at whichever entry point
  // opened it: a per-message "Track as feedback" pick, an AI "Track as post"
  // suggestion accepted from a note chip (carries a board), or the
  // conversation-level button in the detail panel. Null = dialog closed.
  // Convert-to-post is conversation-only (§2.5/§2.7 — deferred for tickets).
  const [convertSeed, setConvertSeed] = useState<{
    title: string
    content: string
    boardId?: string
  } | null>(null)
  // The message driving the share-post picker (conversation-only).
  const [shareMsg, setShareMsg] = useState<AgentConversationMessageDTO | null>(null)
  // The end-conversation reason dialog (conversation-only).
  const [endDialogOpen, setEndDialogOpen] = useState(false)

  // "Jump to message" deep-link state (conversation-only). pendingTarget is the
  // message we still need to scroll to (null once resolved); highlightId is the
  // one currently flashing. pendingTargetRef mirrors pendingTarget so the
  // auto-scroll-to-bottom effect can read it without listing it as a dep (which
  // would re-fire a bottom-scroll the instant the jump resolves).
  const [pendingTarget, setPendingTarget] = useState<ConversationMessageId | null>(targetMessageId)
  const [highlightId, setHighlightId] = useState<ConversationMessageId | null>(null)
  const pendingTargetRef = useRef<ConversationMessageId | null>(targetMessageId)
  pendingTargetRef.current = pendingTarget
  const jumpPagesRef = useRef(0)

  const sendTyping = useTypingSender(isTicket ? null : conversationId)
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

  // Both kind's thread queries are always called (rules of hooks) but only one
  // is ever `enabled` — the conversation adapter is unchanged from before the
  // fold (same key/query the route loader's SSR prefetch warms); the ticket
  // adapter reads the sibling factory in queries/inbox.ts.
  const { data: convThread, isLoading: convLoading } = useQuery({
    ...conversationInboxQueries.thread(conversationId ?? INACTIVE_CONVERSATION_ID),
    enabled: !isTicket,
  })
  const { data: ticketThread, isLoading: ticketThreadLoading } = useQuery({
    ...inboxQueries.ticketThread(ticketId ?? INACTIVE_TICKET_ID),
    enabled: isTicket,
  })
  const { data: ticket, isLoading: ticketDetailLoading } = useQuery({
    ...inboxQueries.ticketDetail(ticketId ?? INACTIVE_TICKET_ID),
    enabled: isTicket,
  })

  // The linked customer ticket (unified inbox §2.1's one-row rule): a plain
  // conversation may wear a ticket chip/status pill even though it renders
  // its own row. Resolved in two hops — the summary tells us the id, then
  // the full DTO (same cache key as a ticket item's own `ticket` query above)
  // drives the header's ticket-status pill + the panel's Ticket card/Links.
  const { data: linkedTicketSummary } = useQuery({
    ...inboxQueries.conversationTicketLink(conversationId ?? INACTIVE_CONVERSATION_ID),
    enabled: !isTicket && !!conversationId,
  })
  const linkedTicketId = linkedTicketSummary?.id ?? null
  const { data: linkedTicketFull } = useQuery({
    ...inboxQueries.ticketDetail(linkedTicketId ?? INACTIVE_TICKET_ID),
    enabled: !!linkedTicketId,
  })
  // The ticket in scope for both the header pill and the detail panel: the
  // item's own ticket (a ticket item), or the conversation's linked one.
  const panelTicket: TicketDTO | null | undefined = isTicket ? ticket : linkedTicketFull

  // The ticket status catalogue, needed to resolve "Resolve" -> the default
  // closed-category status (§3.4), and the close-confirm's "Resolve ticket
  // and close" -> the 'resolved' closed status. Shared cache key with the
  // route's own read, so mounting both costs one request, not two.
  const { data: ticketStatusList } = useQuery({
    ...ticketQueries.statuses(),
    enabled: isTicket || !!linkedTicketId,
  })

  const conversation = convThread?.conversation
  const messages: AgentConversationMessageDTO[] = isTicket
    ? (ticketThread?.messages ?? [])
    : (convThread?.messages ?? [])
  const hasMoreOlder = isTicket ? (ticketThread?.hasMore ?? false) : (convThread?.hasMore ?? false)
  const isLoading = isTicket ? ticketThreadLoading || ticketDetailLoading : convLoading

  // Derived once the ticket's type is known; a plain-object default while it's
  // still loading (never rendered — the isLoading guard below returns first).
  const capabilities: ThreadCapabilities = isTicket
    ? ticketCapabilities(ticket?.type ?? 'customer')
    : CONVERSATION_CAPABILITIES

  // back_office/tracker tickets are note-only (§2.5) — force the mode once the
  // ticket's type resolves (it may not be known yet on first render).
  useEffect(() => {
    if (!capabilities.reply) setNoteMode(true)
  }, [capabilities.reply])

  const linkPreviewsEnabled = capabilities.linkPreviews && (flags?.supportInbox ?? false)
  const debouncedComposerText = useDebouncedValue(
    noteMode ? noteDraft.markdown : replyDraft.markdown,
    500
  )

  // The unread divider sits immediately above the first message newer than the
  // agent's read watermark — i.e. the first message that "mark unread" or new
  // arrivals resurfaced. Conversation-only for now: a ticket's assignee
  // watermark isn't exposed on `TicketDTO` yet, and `deepLinkJump`/an in-thread
  // "New" divider aren't part of the ticket capability matrix this milestone —
  // ticket unread is surfaced at the list level (`inboxQueries.itemList`'s
  // per-row badge) instead.
  const agentLastReadAt = conversation?.agentLastReadAt
  const firstUnreadId = useMemo(() => {
    if (isTicket || !agentLastReadAt) return null
    const readMs = new Date(agentLastReadAt).getTime()
    const first = messages.find(
      (m) => m.senderType !== 'system' && new Date(m.createdAt).getTime() > readMs
    )
    return first?.id ?? null
  }, [isTicket, messages, agentLastReadAt])

  // Older-page backfill: the conversation path is the existing shared hook,
  // parameterized to a no-op (`conversationId: null`) when a ticket is open;
  // the ticket path is a small local mirror of it (listTicketMessagesFn's
  // before-cursor + prependOlderTicketMessages), parameterized the same way.
  const { loadingOlder: convLoadingOlder, loadOlder: loadOlderConversation } = useOlderMessages({
    conversationId: isTicket ? null : conversationId,
    messages,
    onPage: (page) =>
      queryClient.setQueryData(threadKey, (prev: AgentThreadCache | undefined) =>
        prependOlderAgentMessages(prev, page)
      ),
    onError: () => toast.error('Failed to load older messages'),
  })
  const [ticketLoadingOlder, setTicketLoadingOlder] = useState(false)
  const loadOlderTicket = useCallback(async () => {
    if (!ticketId || ticketLoadingOlder || messages.length === 0) return
    setTicketLoadingOlder(true)
    try {
      const page = await listTicketMessagesFn({ data: { ticketId, before: messages[0].id } })
      queryClient.setQueryData(ticketThreadKey, (prev: TicketThreadCache | undefined) =>
        prependOlderTicketMessages(prev, page)
      )
    } catch {
      toast.error('Failed to load older messages')
    } finally {
      setTicketLoadingOlder(false)
    }
  }, [ticketId, ticketLoadingOlder, messages, queryClient, ticketThreadKey])
  const loadingOlder = isTicket ? ticketLoadingOlder : convLoadingOlder
  const loadOlder = isTicket ? loadOlderTicket : loadOlderConversation

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
  // Stable handlers for the (now `memo`'d) InboxDetailPanel — an inline arrow
  // here would be a fresh prop every render and defeat the memo outright.
  // trackConvoTitle/trackConvoContent only change when the conversation/first
  // visitor message actually does, so this rarely recreates in practice.
  const handleTrackAsFeedback = useCallback(
    () => setConvertSeed({ title: trackConvoTitle, content: trackConvoContent }),
    [trackConvoTitle, trackConvoContent]
  )
  const handleCreateTicketFromPanel = useCallback(() => setCreateTicketOpen(true), [])

  // The conversation DTO carries no principal type, so treat "no captured
  // contact email on file" as the anonymous-visitor signal — exactly when the
  // convert dialog should offer the optional email-capture field.
  const visitorContactEmail = conversation?.visitorEmail ?? null
  const visitorIsAnonymous = conversation != null && visitorContactEmail == null

  // Whether the open conversation is already closed — hides the overflow's
  // "End conversation" item once it no longer applies.
  const isClosedConversation = !isTicket && conversation?.status === 'closed'

  // Create-ticket dialog defaults (unified inbox §M5): title from the subject
  // or first message (mirrors "Track as feedback"'s own default), requester
  // fixed to this conversation's visitor.
  const createTicketDefaultRequester = conversation
    ? {
        principalId: conversation.visitor.principalId,
        name: conversation.visitor.displayName,
        email: visitorContactEmail,
        image: conversation.visitor.avatarUrl,
      }
    : null

  // The agent's latest message is "Seen" once the visitor read watermark
  // reaches it. Conversation-only (a ticket carries no visitor read watermark
  // on its DTO yet) — `conversation` is undefined for a ticket, so this is
  // naturally false there.
  const lastAgentMessage = messages.findLast((m) => m.senderType === 'agent')
  const lastAgentSeen =
    !!conversation?.visitorLastReadAt &&
    !!lastAgentMessage &&
    new Date(conversation.visitorLastReadAt).getTime() >=
      new Date(lastAgentMessage.createdAt).getTime()

  // Quinn's proactive suggested-reply card (QUINN-PROACTIVE-SUGGESTIONS-SPEC.md)
  // triggers when the latest customer-facing message is the customer's with no
  // teammate reply after it — i.e. the very last meaningful message is
  // `visitor` (senderType is overloaded across both kinds; see types.ts). The
  // scan skips system events AND internal notes: a teammate jotting a note is
  // not a reply, and must not suppress the card while the customer still
  // waits. Null (no card) when a teammate/Quinn already replied last, this
  // item can't even take a reply (a back_office/tracker ticket is note-only —
  // nowhere for a suggestion to land), OR the item is already closed (a
  // closed conversation / closed-category ticket owes the customer nothing;
  // the suggest route mirrors this guard server-side).
  const isClosedItem = isTicket ? ticket?.status.category === 'closed' : isClosedConversation
  const lastMeaningfulMessage = messages.findLast((m) => m.senderType !== 'system' && !m.isInternal)
  const suggestedReplyMessageId =
    capabilities.reply && !isClosedItem && lastMeaningfulMessage?.senderType === 'visitor'
      ? lastMeaningfulMessage.id
      : null

  // Phase C conversational block layer, agent side (CF3): the same pure
  // derivation the customer-facing widget renders from (conversation-rows.ts),
  // computed ONCE per [messages, conversation.status] and threaded into rows
  // so AgentMessageBubble's read-only block summary can tell an answered
  // block from a still-pending one instead of always rendering the "live"
  // look. A ticket carries no block messages, so this is a harmless no-op map
  // for that path.
  const blockStates = useMemo(
    () => computeBlockStates(messages, conversation?.status === 'closed'),
    [messages, conversation?.status]
  )

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
        showTyping: capabilities.typing && isVisitorTyping,
        blockStates,
      }),
    [
      messages,
      hasMoreOlder,
      firstUnreadId,
      lastAgentSeen,
      isVisitorTyping,
      capabilities.typing,
      blockStates,
    ]
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
  // Conversation-only — a ticket selection never carries a `?m=`.
  useEffect(() => {
    setPendingTarget(targetMessageId)
    jumpPagesRef.current = 0
  }, [targetMessageId])

  // Resolve a pending jump: once the target message is loaded, center it via the
  // virtualizer and flash it (scrollToIndex self-corrects as off-screen rows are
  // measured); otherwise pull older pages (capped) until it appears or we run
  // out. Giving up clears pendingTarget so normal scrolling resumes.
  useEffect(() => {
    if (!capabilities.deepLinkJump || !pendingTarget || isLoading) return
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
  }, [
    capabilities.deepLinkJump,
    pendingTarget,
    rows,
    isLoading,
    hasMoreOlder,
    loadingOlder,
    virtualizer,
    loadOlder,
  ])

  // Clear the flash once it has played through.
  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => setHighlightId(null), FLASH_MS)
    return () => clearTimeout(t)
  }, [highlightId])

  // Clear the agent-side unread badge when a thread is open and new visitor
  // messages arrive — opening + reading should mark read, not only replying.
  // Conversation adapter: the existing shared hook, no-op'd (`conversationId:
  // null`) while a ticket is open.
  useMarkReadOnIncoming({
    conversationId: isTicket ? null : conversationId,
    messages,
    whenLastFrom: 'visitor',
    enabled: !isLoading,
    onMarked: onChanged,
  })
  // Ticket adapter: mark read once the thread has loaded, and again whenever a
  // new message lands while it's open — simpler than the conversation side's
  // sender-side gating (an agent's own reply re-marking read is a harmless
  // no-op here, and a ticket carries no per-message read nuance yet).
  useEffect(() => {
    if (!ticketId || isLoading) return
    void markTicketReadFn({ data: { ticketId } })
      .then(() => onChanged())
      .catch(() => {})
    // lastMessageId (declared above) re-fires this on every new arrival.
  }, [ticketId, isLoading, lastMessageId, onChanged])

  // Apply `update`/removal to the message with `messageId` in whichever thread
  // cache is active. Reactions/flags/delete all resolve their target purely
  // from `messageId` server-side (the fns take no conversationId/ticketId), so
  // one message-level action can target either cache uniformly — only the
  // cache WRITE needs to know which kind is open.
  const patchActiveMessage = useCallback(
    (
      messageId: ConversationMessageId,
      update: (m: AgentConversationMessageDTO) => AgentConversationMessageDTO
    ) => {
      if (isTicket) {
        queryClient.setQueryData(ticketThreadKey, (prev: TicketThreadCache | undefined) =>
          updateTicketThreadMessage(prev, messageId, update)
        )
      } else {
        queryClient.setQueryData(threadKey, (prev: AgentThreadCache | undefined) =>
          updateAgentThreadMessage(prev, messageId, update)
        )
      }
    },
    [isTicket, queryClient, ticketThreadKey, threadKey]
  )
  const removeActiveMessage = useCallback(
    (messageId: ConversationMessageId) => {
      if (isTicket) {
        queryClient.setQueryData(ticketThreadKey, (prev: TicketThreadCache | undefined) =>
          removeTicketThreadMessage(prev, messageId)
        )
      } else {
        queryClient.setQueryData(threadKey, (prev: AgentThreadCache | undefined) =>
          removeAgentThreadMessage(prev, messageId)
        )
      }
    },
    [isTicket, queryClient, ticketThreadKey, threadKey]
  )
  const invalidateActiveThread = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: isTicket ? ticketThreadKey : threadKey })
  }, [isTicket, queryClient, ticketThreadKey, threadKey])

  // Merge a freshly-sent message into the open thread's cache (dedup by id).
  // `res.conversation` is only present on the conversation path's response.
  const appendToThread = (res: {
    conversation?: ConversationDTO
    message: ConversationMessageDTO
  }) => {
    if (isTicket) {
      queryClient.setQueryData(ticketThreadKey, (prev: TicketThreadCache | undefined) =>
        appendSentTicketMessage(prev, { message: res.message })
      )
    } else {
      queryClient.setQueryData(threadKey, (prev: AgentThreadCache | undefined) =>
        appendSentAgentMessage(prev, {
          conversation: res.conversation as ConversationDTO,
          message: res.message,
        })
      )
    }
    onChanged()
  }

  const sendMutation = useMutation({
    mutationFn: (vars: {
      content: string
      contentJson: JSONContent | null
      attachments?: ConversationAttachment[]
      // P2-D.1: the explicit "Send untranslated" fallback offered after a
      // TRANSLATION_FAILED error — bypasses translation for this one send.
      // Conversation-only; the ticket send path never throws these errors.
      skipTranslation?: boolean
    }) =>
      isTicket
        ? sendTicketMessageFn({
            data: {
              ticketId: ticketId ?? INACTIVE_TICKET_ID,
              content: vars.content,
              contentJson: vars.contentJson,
              attachments: vars.attachments,
            },
          })
        : sendAgentMessageFn({
            data: {
              conversationId: conversationId ?? INACTIVE_CONVERSATION_ID,
              content: vars.content,
              contentJson: vars.contentJson,
              attachments: vars.attachments,
              skipTranslation: vars.skipTranslation,
            },
          }),
    onSuccess: (res) => {
      clearAttachments()
      // Our own send always lands at the bottom (followOnAppend only follows
      // when already at end); the layout effect scrolls once the row exists.
      pendingOwnSendScroll.current = true
      appendToThread(res)
    },
    onError: (error, vars) => {
      // The reply carried an inline image/embed that a translated send cannot
      // preserve — BLOCKED before the model ever ran (see
      // resolveOutgoingReplyTranslation), never silently dropped. Same choice
      // UX as the unavailable-translation case below.
      if (error instanceof Error && isTranslationRichContentMessage(error.message)) {
        toast.error('Could not translate your reply.', {
          description:
            'Translation cannot carry images or embeds. Send untranslated to keep them, or remove them and try again.',
          action: {
            label: 'Send untranslated',
            onClick: () => sendMutation.mutate({ ...vars, skipTranslation: true }),
          },
        })
        return
      }
      // Translation failed and the send was BLOCKED (never sent untranslated
      // silently) — offer the explicit fallback rather than a generic toast.
      if (error instanceof Error && isTranslationUnavailableMessage(error.message)) {
        toast.error('Could not translate your reply.', {
          description: 'Send it in your own language instead, or try again.',
          action: {
            label: 'Send untranslated',
            onClick: () => sendMutation.mutate({ ...vars, skipTranslation: true }),
          },
        })
        return
      }
      toast.error('Failed to send message')
    },
  })

  const noteMutation = useMutation({
    mutationFn: (vars: {
      content: string
      contentJson: JSONContent | null
      attachments?: ConversationAttachment[]
    }) =>
      isTicket
        ? addTicketNoteFn({
            data: {
              ticketId: ticketId ?? INACTIVE_TICKET_ID,
              content: vars.content,
              contentJson: vars.contentJson,
              attachments: vars.attachments,
            },
          })
        : addConversationNoteFn({
            data: {
              conversationId: conversationId ?? INACTIVE_CONVERSATION_ID,
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
  // and the inbox after a metadata mutation handled by a child CONVERSATION
  // control. Conversation-only — the ticket header's controls call `onChanged`
  // (the route's own refresh) directly, mirroring the pre-fold TicketDetail:
  // their mutations already seed `ticketKeys.detail`/`ticketKeys.list` caches
  // themselves (lib/client/mutations/inbox.ts), so there's nothing extra to
  // invalidate here for a ticket.
  const refreshThread = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: threadKey })
    // The detail panel's "Previous conversations" list has its own cache key —
    // keep it fresh after a status/assignment/label change.
    void queryClient.invalidateQueries({ queryKey: conversationKeys.agentUserConversations() })
    onChanged()
  }, [queryClient, threadKey, onChanged])

  // P2-D.1 inbox translation: activation banner/toggle + per-message
  // translation display, gated on the flag AND the capability. A no-op hook
  // (everything false/undefined) whenever either is off, so a ticket's
  // behavior is unaffected.
  const inboxTranslationEnabled = capabilities.inboxTranslation && (flags?.inboxAi ?? false)
  const inboxTranslation = useInboxTranslation({
    enabledFlag: inboxTranslationEnabled,
    conversationId: conversationId ?? INACTIVE_CONVERSATION_ID,
    translationState: conversation?.translation,
    messages,
    onChanged: refreshThread,
  })

  const deleteMutation = useMutation({
    mutationFn: (messageId: ConversationMessageId) =>
      deleteConversationMessageFn({ data: { messageId } }),
    onSuccess: (_r, messageId) => removeActiveMessage(messageId),
    onError: () => toast.error('Failed to delete message'),
  })

  // Toggle the caller's emoji reaction on a message (optimistic; the SSE
  // message_updated reconciles counts across agents on the conversation side —
  // a ticket-parented reaction has no live broadcast yet, see message.actions.ts,
  // so this mutation's own onSuccess is the only reconciliation there). The
  // server fn resolves the message's parent by id, so it's shared verbatim by
  // both kinds.
  const reactionMutation = useMutation({
    mutationFn: (vars: { messageId: ConversationMessageId; emoji: string; hasReacted: boolean }) =>
      (vars.hasReacted ? removeMessageReactionFn : addMessageReactionFn)({
        data: { messageId: vars.messageId, emoji: vars.emoji },
      }),
    onMutate: (vars) =>
      patchActiveMessage(vars.messageId, (m) =>
        toggleReactionLocal(m, vars.emoji, vars.hasReacted, myName)
      ),
    // Reconcile to the server's canonical reaction list (real reactor names +
    // authoritative counts) for just this message — no thread refetch, so loaded
    // history and scroll position are preserved.
    onSuccess: (data, vars) =>
      patchActiveMessage(vars.messageId, (m) => ({ ...m, reactions: data.reactions })),
    onError: () => {
      toast.error('Failed to update reaction')
      invalidateActiveThread()
    },
  })

  // Toggle the caller's personal "Saved for later" flag on a message
  // (optimistic; reconciled to the server's flaggedAt; refreshes the saved
  // feed). Shared verbatim by both kinds — see reactionMutation's comment.
  const flagMutation = useMutation({
    mutationFn: (vars: { messageId: ConversationMessageId; flagged: boolean }) =>
      setMessageFlagFn({ data: { messageId: vars.messageId, flagged: vars.flagged } }),
    onMutate: (vars) =>
      patchActiveMessage(vars.messageId, (m) => ({
        ...m,
        flaggedAt: vars.flagged ? (m.flaggedAt ?? new Date().toISOString()) : null,
      })),
    onSuccess: (data, vars) => {
      patchActiveMessage(vars.messageId, (m) => ({ ...m, flaggedAt: data.flaggedAt }))
      // The "Saved for later" feed changed.
      void queryClient.invalidateQueries({ queryKey: conversationKeys.agentFlagged() })
    },
    onError: () => {
      toast.error('Failed to update flag')
      invalidateActiveThread()
    },
  })

  // Remove the active SLA (overflow menu); the thread refetch drops the chip
  // and other agents' inboxes update off the broadcast. Conversation-only — a
  // ticket has no SLA chip in this milestone's header.
  const removeSlaMutation = useMutation({
    mutationFn: () =>
      removeConversationSlaFn({
        data: { conversationId: conversationId ?? INACTIVE_CONVERSATION_ID },
      }),
    onSuccess: () => {
      toast.success('SLA removed')
      refreshThread()
    },
    onError: () => toast.error('Failed to remove SLA'),
  })

  // Mark unread from a message. The conversation and ticket fns each need their
  // own parent id (unlike reactions/flags/delete, which resolve it from the
  // message row) — see markConversationUnreadFromMessageFn/
  // markTicketUnreadFromMessageFn's schemas. onChanged refreshes the inbox
  // badge; the thread stays open (the auto-read effect's deps are stable, so it
  // won't immediately re-mark read).
  const markUnreadMutation = useMutation({
    mutationFn: (messageId: ConversationMessageId) =>
      isTicket
        ? markTicketUnreadFromMessageFn({
            data: { ticketId: ticketId ?? INACTIVE_TICKET_ID, messageId },
          })
        : markConversationUnreadFromMessageFn({
            data: { conversationId: conversationId ?? INACTIVE_CONVERSATION_ID, messageId },
          }),
    onSuccess: () => onChanged(),
    onError: () => toast.error('Failed to mark unread'),
  })

  // Stable per-message dispatchers for AgentMessageBubble (perf review): each
  // bubble is `memo`'d, so passing a FRESH closure per message per render
  // (the pre-refactor shape — e.g. `() => deleteMutation.mutate(m.id)` built
  // fresh inside renderRow for every row on every render) would defeat the
  // memo outright, since a new function reference always fails the prop
  // equality check. These read the message id (or the whole message, where
  // the handler needs its content) as an argument instead, so the SAME
  // top-level reference is handed to every row; `mutate`/`mutateAsync` from
  // `useMutation` are themselves stable across renders, so these only need to
  // be recreated if the mutation's `.mutate` identity ever changed (it
  // doesn't in practice).
  const handleToggleReaction = useCallback(
    (messageId: ConversationMessageId, emoji: string, hasReacted: boolean) =>
      reactionMutation.mutate({ messageId, emoji, hasReacted }),
    [reactionMutation.mutate]
  )
  const handleToggleFlag = useCallback(
    (messageId: ConversationMessageId, next: boolean) =>
      flagMutation.mutate({ messageId, flagged: next }),
    [flagMutation.mutate]
  )
  const handleSharePost = useCallback((message: AgentConversationMessageDTO) => {
    setShareMsg(message)
  }, [])
  const handleTrackAsPost = useCallback((message: AgentConversationMessageDTO) => {
    setConvertSeed({ title: message.content.trim().slice(0, 200), content: message.content })
  }, [])
  const handleTrackSuggestion = useCallback((message: AgentConversationMessageDTO) => {
    if (message.postSuggestion) setConvertSeed(message.postSuggestion)
  }, [])

  // ── Header action bar (§2.7) ─────────────────────────────────────────────

  // Create-ticket dialog (conversations only): opened from the header icon,
  // the panel's Ticket card empty slot, or the route's command-bar action —
  // the latter via `createTicketToken`, since only this component holds the
  // conversation data (subject/first message/visitor) the dialog prefills
  // from.
  const [createTicketOpen, setCreateTicketOpen] = useState(false)
  const createTicketTokenRef = useRef(createTicketToken)
  useEffect(() => {
    if (createTicketToken !== undefined && createTicketToken !== createTicketTokenRef.current) {
      createTicketTokenRef.current = createTicketToken
      if (!isTicket) setCreateTicketOpen(true)
    }
  }, [createTicketToken, isTicket])

  // Save for later (star/bookmark icon, both kinds): the pragmatic thread-
  // level affordance — flags the LATEST message, reusing the same per-message
  // flag primitive the "Saved for later" feed already reads (there is no
  // separate thread-level save row).
  const lastMessage = messages.at(-1)
  const lastMessageFlagged = lastMessage?.flaggedAt != null
  const toggleSaveForLater = useCallback(() => {
    if (!lastMessage) return
    flagMutation.mutate({ messageId: lastMessage.id, flagged: !lastMessageFlagged })
  }, [lastMessage, lastMessageFlagged, flagMutation])

  // Snooze (moon icon, conversations only) — the same preset menu
  // StatusControl used to carry (§2.7 moves it into the header's icon
  // cluster; StatusControl keeps only Open/Closed + the current snoozed-
  // until label).
  const [snoozeCustomOpen, setSnoozeCustomOpen] = useState(false)
  const [snoozeCustomDate, setSnoozeCustomDate] = useState<Date | undefined>(() => tomorrowAt(9))
  const snoozeMutation = useMutation({
    mutationFn: (until: string | null) =>
      snoozeConversationFn({
        data: { conversationId: conversationId ?? INACTIVE_CONVERSATION_ID, until },
      }),
    onSuccess: () => refreshThread(),
    onError: () => toast.error('Failed to snooze conversation'),
  })
  const snooze = (until: string | null) => snoozeMutation.mutate(until)

  // Block / unblock the visitor (overflow menu, conversations only).
  const { blocked: visitorBlocked } = usePersonBlockStatus(conversation?.visitor.principalId)
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false)
  const blockStatusKey = ['admin', 'person-block-status', conversation?.visitor.principalId]
  const blockMutation = useMutation({
    mutationFn: () => blockPersonFn({ data: { principalId: conversation!.visitor.principalId } }),
    onSuccess: () => {
      toast.success('Person blocked')
      void queryClient.invalidateQueries({ queryKey: blockStatusKey })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to block'),
  })
  const unblockMutation = useMutation({
    mutationFn: () => unblockPersonFn({ data: { principalId: conversation!.visitor.principalId } }),
    onSuccess: () => {
      toast.success('Person unblocked')
      void queryClient.invalidateQueries({ queryKey: blockStatusKey })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to unblock'),
  })

  // Export transcript (overflow menu, both kinds).
  const [exporting, setExporting] = useState(false)
  const exportTranscript = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      await downloadTranscriptFile(() =>
        isTicket
          ? exportTicketTranscriptFn({ data: { ticketId: ticketId ?? INACTIVE_TICKET_ID } })
          : exportConversationTranscriptFn({
              data: { conversationId: conversationId ?? INACTIVE_CONVERSATION_ID },
            })
      )
    } catch {
      toast.error('Could not export the transcript. Please try again.')
    } finally {
      setExporting(false)
    }
  }, [exporting, isTicket, ticketId, conversationId])

  // Copy link (overflow menu, both kinds): /admin/inbox?i=<id>.
  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/admin/inbox?i=${item.id}`
    void navigator.clipboard.writeText(url).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy the link')
    )
  }, [item.id])

  // Close (conversations) / Resolve (tickets) — the primary button. A
  // conversation close keeps the required-attributes guard (a local
  // RequiredAttributesDialog, mirroring StatusControl's own instance); a
  // ticket resolve sets the workspace's default closed-category status.
  const [closeBlocked, setCloseBlocked] = useState<string[] | null>(null)
  const closeConversationMutation = useMutation({
    mutationFn: () =>
      setConversationStatusFn({
        data: { conversationId: conversationId ?? INACTIVE_CONVERSATION_ID, status: 'closed' },
      }),
    onSuccess: () => {
      toast.success('Conversation closed')
      refreshThread()
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : null
      if (message && isMissingRequiredAttributesMessage(message)) setCloseBlocked([message])
      else toast.error('Failed to close conversation')
    },
  })
  const resolveTicketMutation = useMutation({
    mutationFn: (statusId: string) =>
      setTicketStatusFn({ data: { ticketId: ticketId ?? INACTIVE_TICKET_ID, statusId } }),
    onSuccess: () => {
      toast.success('Ticket resolved')
      onChanged()
    },
    onError: () => toast.error('Failed to resolve ticket'),
  })
  // Closing a conversation that still links an OPEN customer ticket asks
  // first (the one-row rule would then hide that open ticket from every
  // default surface): the confirm offers "Resolve ticket and close" vs
  // "Close conversation only". The open-ness check re-reads the link at
  // click time — `staleTime: 0` forces a refetch past the link query's 30s
  // cache, so a ticket resolved (or reopened) seconds ago is never judged
  // from the stale summary. The linked-ticket resolve goes through the
  // shared mutation hook, which seeds the ticket's detail cache the same
  // way the header's own status control does.
  const [closeConfirmTicket, setCloseConfirmTicket] = useState<LinkedTicketSummary | null>(null)
  const [closeCheckPending, setCloseCheckPending] = useState(false)
  const linkedTicketStatusMutation = useSetTicketStatus()
  const primaryActionPending = isTicket
    ? resolveTicketMutation.isPending
    : closeConversationMutation.isPending || closeCheckPending
  const runPrimaryAction = useCallback(() => {
    if (isTicket) {
      const closedStatusId = resolveDefaultClosedStatusId(ticketStatusList)
      if (!closedStatusId) {
        toast.error('No closed ticket status is configured')
        return
      }
      resolveTicketMutation.mutate(closedStatusId)
      return
    }
    setCloseCheckPending(true)
    queryClient
      .fetchQuery({
        ...inboxQueries.conversationTicketLink(conversationId ?? INACTIVE_CONVERSATION_ID),
        staleTime: 0,
      })
      .then((linked) => {
        if (linked && linked.statusCategory !== 'closed') setCloseConfirmTicket(linked)
        else closeConversationMutation.mutate()
      })
      // A failed freshness check must not block the close — fall back to the
      // pre-guard behavior (close unconditionally).
      .catch(() => closeConversationMutation.mutate())
      .finally(() => setCloseCheckPending(false))
  }, [
    isTicket,
    ticketStatusList,
    resolveTicketMutation,
    closeConversationMutation,
    queryClient,
    conversationId,
  ])
  // The close confirm's two non-cancel actions. "Resolve ticket and close"
  // stamps the workspace's resolved closed-category status on the linked
  // ticket first and only then closes — a failed resolve leaves both sides
  // untouched (and the dialog open).
  const closeConfirmPending =
    linkedTicketStatusMutation.isPending || closeConversationMutation.isPending
  const closeConversationOnly = useCallback(() => {
    setCloseConfirmTicket(null)
    closeConversationMutation.mutate()
  }, [closeConversationMutation])
  const resolveTicketAndClose = useCallback(async () => {
    if (!closeConfirmTicket) return
    const statusId = resolveResolvedStatusId(ticketStatusList)
    if (!statusId) {
      toast.error('No closed ticket status is configured')
      return
    }
    try {
      await linkedTicketStatusMutation.mutateAsync({
        ticketId: closeConfirmTicket.id,
        statusId: statusId as TicketStatusId,
      })
    } catch {
      toast.error('Failed to resolve ticket')
      return
    }
    setCloseConfirmTicket(null)
    closeConversationMutation.mutate()
  }, [closeConfirmTicket, ticketStatusList, linkedTicketStatusMutation, closeConversationMutation])

  // Seed an insert into a mode's draft, then remount that editor so the new
  // value is loaded and the cursor lands at its end. The unified RichTextEditor
  // exposes no imperative insert, so every "insert at cursor" affordance (macros,
  // Copilot, the emoji picker) routes through the controlled value + remount key.
  // One seam per converter: plain text (macros/emoji — literal paragraphs) vs
  // Copilot answer (markdown-lite → real editor nodes, citation markers
  // stripped; see appendAnswerToDraft).
  const insertIntoDraft = useCallback(
    (mode: 'reply' | 'note', append: (prev: ComposerDraft) => ComposerDraft) => {
      if (mode === 'note') {
        setNoteDraft(append)
        setNoteKey((k) => k + 1)
      } else {
        setReplyDraft(append)
        setReplyKey((k) => k + 1)
      }
    },
    []
  )
  const insertText = useCallback(
    (mode: 'reply' | 'note', text: string) =>
      insertIntoDraft(mode, (prev) => appendTextToDraft(prev, text)),
    [insertIntoDraft]
  )
  const insertAnswer = useCallback(
    (mode: 'reply' | 'note', text: string) =>
      insertIntoDraft(mode, (prev) => appendAnswerToDraft(prev, text)),
    [insertIntoDraft]
  )
  // Stable reply-mode text insert for the MacroPicker prop.
  const insertMacroBody = useCallback((text: string) => insertText('reply', text), [insertText])

  // The Copilot "Add to composer" / "Add as note" seam (COPILOT-SIDEBAR-UX.md
  // B.4) targets either mode and may need to flip `noteMode` first — see
  // use-copilot-insert.ts for the mount-timing fix. It drives the editors through
  // insertable handles; with the unified editor those handles just seed the draft
  // (value + remount). Kept in stable refs so insertFromCopilot's identity — and
  // therefore the detail panel — doesn't churn on every keystroke. Only reached
  // when the conversation detail panel's Copilot tab renders (conversation-only).
  const replyInsertRef = useRef<{ insertText: (text: string) => void } | null>(null)
  const noteInsertRef = useRef<{ insertText: (text: string) => void } | null>(null)
  replyInsertRef.current = { insertText: (text: string) => insertAnswer('reply', text) }
  noteInsertRef.current = { insertText: (text: string) => insertAnswer('note', text) }
  const insertFromCopilot = useCopilotInsert({
    noteMode,
    setNoteMode,
    replyComposerRef: replyInsertRef,
    noteEditorRef: noteInsertRef,
  })

  const getComposerText = useCallback(
    (mode: ComposerMode) =>
      mode === 'note' ? noteDraftRef.current.markdown : replyDraftRef.current.markdown,
    []
  )
  // The suggested-reply card's composer gate: a teammate already mid-draft
  // when the card's dwell elapses doesn't need (or pay for) a suggestion.
  const composerHasText = useCallback(() => replyDraftRef.current.markdown.trim().length > 0, [])
  const replaceComposerText = useCallback((mode: ComposerMode, text: string) => {
    const previous = mode === 'note' ? noteDraftRef.current : replyDraftRef.current
    const apply = (draft: ComposerDraft) => {
      if (mode === 'note') {
        setNoteDraft(draft)
        setNoteKey((k) => k + 1)
      } else {
        setReplyDraft(draft)
        setReplyKey((k) => k + 1)
      }
    }
    apply(answerToDraft(text))
    // Replacing the document remounts the editor and clears its native history.
    // Return a full-fidelity restore for the composer's persistent inline Undo.
    return () => apply(previous)
  }, [])
  const insertSummaryNote = useCallback(
    (text: string) => insertFromCopilot(text, 'note'),
    [insertFromCopilot]
  )

  // Track each mode's draft from the editor's onChange (json + markdown mirror).
  // The reply keystroke also drives the visitor-facing typing indicator (only
  // when the capability is on — a ticket reply never signals typing); a note
  // is internal, so it never signals typing either way. Both callbacks are
  // stable so the editor's extensions aren't rebuilt on every render.
  const onReplyChange = useCallback(
    (json: JSONContent, _html: string, markdown: string) => {
      setReplyDraft({ json: json as TiptapContent, markdown })
      if (capabilities.typing) onLocalInput()
    },
    [onLocalInput, capabilities.typing]
  )
  const onNoteChange = useCallback(
    (json: JSONContent, _html: string, markdown: string) =>
      setNoteDraft({ json: json as TiptapContent, markdown }),
    []
  )

  // Enter-to-send routes through onSubmit, so it must be a STABLE callback — an
  // inline arrow would churn the editor's extension identity every keystroke.
  // Read the latest state through a ref refreshed each render. A message is
  // sendable when the doc carries text or an inline image/embed (isEmptyTiptapDoc
  // counts any non-text node as content), OR a file is staged in the tray;
  // `content` is the doc's markdown, `contentJson` the doc (null when it's only
  // an attachment). Text/doc clear optimistically; tray attachments clear in the
  // mutation's onSuccess. `!capabilities.reply` forces note mode regardless of
  // `noteMode`'s own state (defense in depth alongside the effect above).
  const sendRef = useRef<() => void>(() => {})
  sendRef.current = () => {
    const useNote = noteMode || !capabilities.reply
    const draft = useNote ? noteDraft : replyDraft
    const empty = isEmptyTiptapDoc(draft.json ?? undefined)
    const hasAttachments = pendingAttachments.length > 0
    const mutation = useNote ? noteMutation : sendMutation
    if ((empty && !hasAttachments) || mutation.isPending || uploading) return
    mutation.mutate({
      content: draft.markdown.trim(),
      contentJson: empty ? null : draft.json,
      attachments: hasAttachments ? pendingAttachments : undefined,
    })
    if (useNote) {
      setNoteDraft(EMPTY_DRAFT)
      setNoteKey((k) => k + 1)
    } else {
      setReplyDraft(EMPTY_DRAFT)
      setReplyKey((k) => k + 1)
    }
  }
  const onSend = useCallback(() => sendRef.current(), [])

  const activeDraft = noteMode || !capabilities.reply ? noteDraft : replyDraft
  const activePending =
    noteMode || !capabilities.reply ? noteMutation.isPending : sendMutation.isPending
  const sendDisabled =
    (isEmptyTiptapDoc(activeDraft.json ?? undefined) && pendingAttachments.length === 0) ||
    activePending ||
    uploading

  // Render one virtualized row. AgentMessageBubble keeps all the agent-view
  // behaviors (and its data-message-id root) for every kind.
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
            onDelete={deleteMutation.mutate}
            onToggleReaction={handleToggleReaction}
            onToggleFlag={handleToggleFlag}
            onMarkUnread={markUnreadMutation.mutate}
            onSharePost={capabilities.convertToPost ? handleSharePost : undefined}
            onTrackAsPost={capabilities.convertToPost ? handleTrackAsPost : undefined}
            onTrackSuggestion={capabilities.convertToPost ? handleTrackSuggestion : undefined}
            linkPreviews={linkPreviewsEnabled}
            translation={inboxTranslation.translationFor(m)}
            blockState={row.blockState}
          />
        )
      }
      case 'empty':
        return (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {isTicket
              ? 'No replies yet. Send the first message to the requester.'
              : 'No messages yet'}
          </p>
        )
      case 'seen':
        return <p className="pe-1 text-end text-xs text-muted-foreground/50">Seen</p>
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

  // A ticket may 404 (deleted, or no longer visible) — mirrors the old
  // ticket-detail.tsx's guard, which this component's ticket path replaces.
  if (isTicket && !ticket) {
    return (
      <div className="flex h-full flex-1 min-w-0 items-center justify-center">
        <EmptyState
          icon={ChatBubbleLeftRightIcon}
          title="Ticket not found"
          description="It may have been deleted or you no longer have access."
        />
      </div>
    )
  }

  // The header block differs by kind (§2.5): a conversation keeps its exact
  // identity/status/channel/SLA/CSAT title area; a ticket shows title +
  // reference + type/stage chips. The RIGHT side is the unified action bar
  // (§2.7, M5): a ticket-status pill when the item is or links a ticket, an
  // icon cluster (create ticket / save for later / snooze / overflow), then
  // the primary Close (conversations) / Resolve (tickets) button. Priority/
  // assignee move to the detail panel's Properties row; an xl:hidden fallback
  // keeps them reachable below that breakpoint (the panel is xl-only).
  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted md:hidden"
      aria-label="Back to list"
    >
      <ChevronLeftIcon className="h-5 w-5" />
    </button>
  )
  const headerIconButtonClass =
    'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'

  // The unified action bar's icon cluster + overflow + primary button —
  // identical JSX for both kinds, gated internally by `isTicket`/capabilities.
  const headerActions = (
    <div className="flex shrink-0 items-center gap-1">
      {panelTicket && <TicketStatusControl ticket={panelTicket} onChanged={refreshThread} />}
      {!isTicket && showTickets && !panelTicket && (
        <button
          type="button"
          title="Create ticket"
          aria-label="Create ticket"
          onClick={() => setCreateTicketOpen(true)}
          className={headerIconButtonClass}
        >
          <TicketIcon className="h-4 w-4" />
        </button>
      )}
      {lastMessage && (
        <button
          type="button"
          title="Save for later"
          aria-label="Save for later"
          aria-pressed={lastMessageFlagged}
          onClick={toggleSaveForLater}
          className={headerIconButtonClass}
        >
          {lastMessageFlagged ? (
            <BookmarkSolidIcon className="h-4 w-4 text-amber-500" />
          ) : (
            <BookmarkIcon className="h-4 w-4" />
          )}
        </button>
      )}
      {!isTicket && conversation && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Snooze"
              aria-label="Snooze"
              disabled={snoozeMutation.isPending}
              className={headerIconButtonClass}
            >
              <MoonIcon className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => snooze(inHours(4).toISOString())}>
              Later today
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => snooze(tomorrowAt(9).toISOString())}>
              Tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => snooze(nextMondayAt(9).toISOString())}>
              Next week
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => snooze(null)}>Until they reply</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setSnoozeCustomDate(tomorrowAt(9))
                // Let the menu finish closing before the dialog grabs focus,
                // so the two Radix overlays don't fight over it.
                requestAnimationFrame(() => setSnoozeCustomOpen(true))
              }}
            >
              Pick a date &amp; time…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* P2-D.1 inbox translation: manual per-conversation toggle. */}
      {inboxTranslationEnabled && conversation && (
        <button
          type="button"
          onClick={inboxTranslation.toggleEnabled}
          disabled={inboxTranslation.togglePending}
          aria-pressed={inboxTranslation.enabled}
          title={
            inboxTranslation.enabled
              ? 'Translation is on for this conversation'
              : 'Turn on translation for this conversation'
          }
          className={cn(
            headerIconButtonClass,
            inboxTranslation.enabled && 'bg-primary/10 text-primary hover:text-primary'
          )}
        >
          <LanguageIcon className="h-4 w-4" />
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={isTicket ? 'More ticket actions' : 'More conversation actions'}
            className={headerIconButtonClass}
          >
            <EllipsisHorizontalIcon className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void exportTranscript()}>
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            {exporting ? 'Exporting…' : 'Export transcript'}
          </DropdownMenuItem>
          {!isTicket && conversation?.visitor.principalId && (
            <DropdownMenuItem
              onClick={() =>
                visitorBlocked ? unblockMutation.mutate() : setBlockConfirmOpen(true)
              }
            >
              <NoSymbolIcon className="h-3.5 w-3.5" />
              {visitorBlocked ? 'Unblock person' : 'Block person'}
            </DropdownMenuItem>
          )}
          {!isTicket && conversation && !isClosedConversation && (
            <DropdownMenuItem onClick={() => setEndDialogOpen(true)}>
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              End conversation
            </DropdownMenuItem>
          )}
          {conversation && capabilities.convertToPost && (
            <DropdownMenuItem
              onSelect={() =>
                setConvertSeed({ title: convertDefaultTitle, content: convertDefaultContent })
              }
            >
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              Convert to post
            </DropdownMenuItem>
          )}
          {!isTicket && conversation?.sla && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => removeSlaMutation.mutate()}
                disabled={removeSlaMutation.isPending}
              >
                Remove SLA ({conversation.sla.policyName})
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={copyLink}>
            <LinkIcon className="h-3.5 w-3.5" />
            Copy link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button type="button" size="sm" onClick={runPrimaryAction} disabled={primaryActionPending}>
        <CheckIcon className="h-4 w-4" />
        {isTicket ? 'Resolve' : 'Close'}
      </Button>
    </div>
  )

  const header: ReactNode =
    isTicket && ticket ? (
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {backButton}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{ticket.title}</p>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-mono">{ticket.reference}</span>
              <TicketTypeBadge type={ticket.type} />
              <TicketStageChip stage={ticket.stage} />
            </p>
          </div>
        </div>
        {/* Narrow-viewport fallback: Properties live in the detail panel at
            xl+; below that, priority/assignee stay reachable here. */}
        <div className="flex shrink-0 items-center gap-1.5 xl:hidden">
          <TicketPriorityControl ticket={ticket} onChanged={onChanged} />
          <TicketAssigneeControl ticket={ticket} onChanged={onChanged} />
        </div>
        {headerActions}
      </div>
    ) : (
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {backButton}
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
              {conversation && <SlaChip sla={conversation.sla} status={conversation.status} />}
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
              conversationId={conversationId ?? INACTIVE_CONVERSATION_ID}
              value={conversation.priority}
              onChanged={refreshThread}
            />
            <AssigneeControl
              conversationId={conversationId ?? INACTIVE_CONVERSATION_ID}
              assignedAgent={conversation.assignedAgent}
              onChanged={refreshThread}
            />
            <StatusControl
              conversationId={conversationId ?? INACTIVE_CONVERSATION_ID}
              status={conversation.status}
              snoozedUntil={conversation.snoozedUntil}
              onChanged={refreshThread}
            />
          </div>
        )}
        {headerActions}
      </div>
    )

  return (
    <div className="flex h-full flex-1 min-w-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header}

        {/* Conversation labels — xl+ shows them in the detail panel. Tickets
            have no tags surface (§2.5's capability matrix — "tags,
            conversations only"). */}
        {!isTicket && conversation && conversationId && (
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

        {/* P2-D.1 inbox translation: dismissible auto-suggest banner, shown
            above the composer when the customer's detected language differs
            from the viewing teammate's own preference. */}
        {inboxTranslation.showSuggestionBanner && (
          <div className="flex items-center gap-2 border-t border-border/50 bg-primary/5 px-4 py-2 text-xs sm:px-5">
            <LanguageIcon className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1 text-foreground/90">
              This customer writes in {inboxTranslation.detectedLanguageLabel}. Translate this
              conversation?
            </span>
            <button
              type="button"
              onClick={inboxTranslation.activateFromSuggestion}
              disabled={inboxTranslation.togglePending}
              className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              Translate
            </button>
            <button
              type="button"
              onClick={inboxTranslation.dismissSuggestion}
              disabled={inboxTranslation.togglePending}
              aria-label="Dismiss"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Composer — no top border: the composer should feel like a
            continuation of the thread, not a separate panel. Horizontal
            padding matches the message rows' `px-5` so the composer and the
            thread above it share the same width. */}
        <div className="px-5 py-3">
          {/* Quinn's proactive suggested-reply card — same horizontal rhythm
              as the composer below it. Renders nothing on its own terms (flag
              off, no eligible customer message, honest-miss skip, dismissed) —
              the conditional here is only the eligibility precondition. */}
          {suggestedReplyMessageId && (
            <SuggestedReplyCard
              key={suggestedReplyMessageId}
              item={item}
              lastCustomerMessageId={suggestedReplyMessageId}
              onInsert={(text) => insertFromCopilot(text, 'reply')}
              onAskCopilot={requestOpenCopilot}
              shouldDeferSuggestion={composerHasText}
            />
          )}
          {/* Composer: the Reply/Note switcher gets its own row on top, then the
              editor, the pending attachment tray, then the actions (attach,
              emoji, saved replies) and send — one bordered box, one unified
              control, instead of a separate mode toggle floating above it.
              Enter sends; Shift+Enter inserts a newline. */}
          <div
            className={cn(
              'rounded-lg border px-3 py-2 focus-within:ring-2',
              noteMode || !capabilities.reply
                ? 'border-amber-400/50 bg-amber-400/5 focus-within:ring-amber-400/20'
                : 'border-border bg-background focus-within:ring-primary/20'
            )}
          >
            {/* Reply vs internal-note mode — a back_office/tracker ticket has
                no reply capability, so Note is the only mode: hide the
                switcher and force note mode (styled as today's note mode,
                per §2.5). */}
            {capabilities.reply && (
              <div className="mb-1.5 flex items-center">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                        noteMode
                          ? 'bg-amber-400/20 text-amber-700 dark:text-amber-300'
                          : 'bg-muted text-foreground hover:bg-muted/80'
                      )}
                    >
                      {noteMode ? 'Note' : 'Reply'}
                      <ChevronDownIcon className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuRadioGroup
                      value={noteMode ? 'note' : 'reply'}
                      onValueChange={(value) => setNoteMode(value === 'note')}
                    >
                      <DropdownMenuRadioItem value="reply">Reply</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="note">Note</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
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
            {/* Reply and Note share the unified RichTextEditor; reply keeps
                @-mentions on (agent surface), note is the team-internal preset.
                Enter sends, Shift+Enter breaks; formatting comes from the editor's
                own bubble/slash/`:` surfaces. Pasted/dropped images inline via
                onImageUpload; the paperclip still stages files in the tray below. */}
            {noteMode || !capabilities.reply ? (
              <RichTextEditor
                key={`note-${noteKey}`}
                value={noteDraft.json ?? ''}
                features={CONVERSATION_NOTE_FEATURES}
                borderless
                minHeight="4.5rem"
                autofocus={noteKey > 0 ? 'end' : false}
                disabled={noteMutation.isPending}
                placeholder="Add an internal note for your team…"
                className="max-h-64 overflow-y-auto"
                onChange={onNoteChange}
                onSubmit={onSend}
                onImageUpload={upload}
              />
            ) : (
              <RichTextEditor
                key={`reply-${replyKey}`}
                value={replyDraft.json ?? ''}
                features={CONVERSATION_EDITOR_FEATURES}
                borderless
                minHeight="4.5rem"
                autofocus={replyKey > 0 ? 'end' : false}
                disabled={sendMutation.isPending}
                placeholder={isTicket ? 'Reply to the requester…' : 'Type your reply…'}
                className="max-h-64 overflow-y-auto"
                onChange={onReplyChange}
                onSubmit={onSend}
                onImageUpload={upload}
              />
            )}
            <ComposerAttachmentTray attachments={pendingAttachments} onRemove={removeAttachment} />
            {/* Live link unfurl while composing (Slack-style) — part of the
                preview tray, gated by the flag + capability. */}
            {linkPreviewsEnabled && <LinkPreviews content={debouncedComposerText} />}
            <div className="flex flex-wrap items-center gap-0.5 pt-1">
              {/* Attach is available in both reply and note mode, for both kinds. */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                aria-label="Attach image"
              >
                <PaperClipIcon className="h-4 w-4" />
              </button>
              {capabilities.emojiPicker && (
                <EmojiPicker
                  className="size-8"
                  onSelect={(emoji) => insertText(noteMode ? 'note' : 'reply', emoji)}
                />
              )}
              {capabilities.macros && !noteMode && conversationId && (
                <MacroPicker
                  conversationId={conversationId}
                  onInsert={insertMacroBody}
                  onApplied={refreshThread}
                />
              )}
              {/* Manual workflow runs (§4.6): no dedicated capability flag
                  exists for this — it reuses `capabilities.macros` since both
                  are the same "conversation-only inbox action, not available
                  on a back_office/tracker ticket" shape (see
                  thread-capabilities.ts's doc for what that flag already
                  covers) rather than adding a capability that would always
                  equal `macros` today. */}
              {capabilities.macros && !noteMode && conversationId && (
                <WorkflowRunPicker conversationId={conversationId} onApplied={refreshThread} />
              )}
              <ComposerAiActions
                item={item}
                activeMode={noteMode || !capabilities.reply ? 'note' : 'reply'}
                activeDraftText={activeDraft.markdown}
                getDraftText={getComposerText}
                onReplaceDraftText={replaceComposerText}
                onInsertNote={insertSummaryNote}
              />
              <div className="flex-1" />
              <button
                type="button"
                onClick={onSend}
                disabled={sendDisabled}
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-md text-primary-foreground disabled:opacity-40 transition-opacity',
                  noteMode || !capabilities.reply ? 'bg-amber-500 text-white' : 'bg-primary'
                )}
                aria-label={noteMode || !capabilities.reply ? 'Add note' : 'Send reply'}
              >
                {noteMode || !capabilities.reply ? (
                  <PencilSquareIcon className="h-4 w-4" />
                ) : (
                  <PaperAirplaneIcon className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Convert/share/end dialogs are conversation-only (§2.5 — convert-to-post
          is deferred for tickets, end-conversation has no ticket equivalent,
          the status axis stands in for it instead). Not rendered at all for a
          ticket, so their state (never set by any ticket-only affordance)
          stays inert. */}
      {!isTicket && conversationId && (
        <>
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
          <CreateTicketDialog
            open={createTicketOpen}
            onOpenChange={setCreateTicketOpen}
            onCreated={onSelectItem}
            conversationId={conversationId}
            defaultTitle={trackConvoTitle}
            defaultRequester={createTicketDefaultRequester}
            onChanged={refreshThread}
          />
          <ConfirmDialog
            open={blockConfirmOpen}
            onOpenChange={setBlockConfirmOpen}
            title={`Block ${conversation?.visitor.displayName || 'this person'}?`}
            description="They will not be able to send new messages or sign in again. Their existing activity stays, and you can unblock them at any time."
            confirmLabel="Block"
            variant="destructive"
            isPending={blockMutation.isPending}
            onConfirm={() => blockMutation.mutate()}
          />
          {/* Close-with-open-linked-ticket guard (three actions, so not the
              shared ConfirmDialog — the button trio follows
              internal-sources-confirm.tsx's AlertDialog pattern). */}
          <AlertDialog
            open={!!closeConfirmTicket}
            onOpenChange={(o) => {
              if (!o) setCloseConfirmTicket(null)
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Ticket {closeConfirmTicket ? formatTicketNumber(closeConfirmTicket.number) : ''}{' '}
                  is still open
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Closing the conversation leaves the ticket open — and with its own inbox row
                  folded into the conversation, it can go stale unnoticed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={closeConfirmPending}
                  onClick={() => setCloseConfirmTicket(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={closeConfirmPending}
                  onClick={closeConversationOnly}
                >
                  Close conversation only
                </Button>
                <Button
                  type="button"
                  disabled={closeConfirmPending}
                  onClick={() => void resolveTicketAndClose()}
                >
                  Resolve ticket and close
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Dialog open={snoozeCustomOpen} onOpenChange={setSnoozeCustomOpen}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Snooze until</DialogTitle>
                <DialogDescription>
                  The conversation leaves your open queue and returns at the time you pick.
                </DialogDescription>
              </DialogHeader>
              <DateTimePicker
                value={snoozeCustomDate}
                onChange={setSnoozeCustomDate}
                minDate={new Date()}
                className="w-full"
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setSnoozeCustomOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!snoozeCustomDate || snoozeMutation.isPending}
                  onClick={() => {
                    if (!snoozeCustomDate) return
                    snooze(snoozeCustomDate.toISOString())
                    setSnoozeCustomOpen(false)
                  }}
                >
                  Snooze
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      <RequiredAttributesDialog messages={closeBlocked} onClose={() => setCloseBlocked(null)} />

      {/* The unified detail panel (§2.7, M5): one panel for both kinds,
          assembled from existing per-kind pieces. */}
      {((!isTicket && conversation) || (isTicket && ticket)) && (
        <InboxDetailPanel
          item={item}
          conversation={conversation}
          ticket={panelTicket}
          onChanged={refreshThread}
          onSelectItem={onSelectItem}
          onTrackAsFeedback={handleTrackAsFeedback}
          onCreateTicket={handleCreateTicketFromPanel}
          onInsertFromCopilot={insertFromCopilot}
          openCopilotToken={openCopilotToken}
        />
      )}
    </div>
  )
}
