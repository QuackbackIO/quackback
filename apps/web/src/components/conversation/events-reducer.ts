/**
 * Pure reducers mapping conversation stream events (and local mutations) onto
 * the thread query caches. Every surface routes its cache writes through here
 * so the semantics — dedupe by id, viewer-relative merge on message_updated,
 * read-watermark routing by side — stay identical across admin, portal, and
 * widget. No React or query-client imports: everything is unit-testable
 * directly (events-reducer.test.ts).
 */
import type { ConversationId, ConversationMessageId, TicketId } from '@quackback/ids'
import {
  asAgentMessage,
  type AgentConversationMessageDTO,
  type ConversationDTO,
  type ConversationMessageDTO,
  type ConversationStatus,
  type ConversationStreamEvent,
  type MessageReactionCount,
} from '@/lib/shared/conversation/types'

// Re-exported for existing callers (`asAgentMessage` used to be defined here);
// its canonical home is lib/shared/conversation/types.ts now, so
// `lib/client/*` query factories — which must not import from `components/`
// — can reach it too (see queries/inbox.ts's `ticketThread`).
export { asAgentMessage }

/** The agent thread cache: messages are AgentConversationMessageDTO (reactions + flag). */
export interface AgentThreadCache {
  conversation: ConversationDTO
  messages: AgentConversationMessageDTO[]
  hasMore?: boolean
}

/** The visitor thread cache (portal + widget): base DTOs plus the thread-level
 *  fields the visitor stream updates (read watermark, status, CSAT). */
export interface VisitorThreadCache {
  messages: ConversationMessageDTO[]
  hasMore: boolean
  agentLastReadAt: string | null
  status: ConversationStatus | null
  csatRating: number | null
}

/** One older page of messages (keyset backfill). */
interface MessagePage {
  messages: ConversationMessageDTO[]
  hasMore: boolean
}

/** Apply an incoming message_updated to a cached message: take its reaction
 *  counts but keep OUR own hasReacted and OUR own flag — both are viewer-relative
 *  (reactions per-user, flags per-agent), so the broadcaster's values are not
 *  ours to apply. */
export function mergeAgentMessage(
  local: AgentConversationMessageDTO,
  incoming: AgentConversationMessageDTO
): AgentConversationMessageDTO {
  const localReacted = new Set(local.reactions.filter((r) => r.hasReacted).map((r) => r.emoji))
  return {
    ...incoming,
    reactions: incoming.reactions.map((r) => ({ ...r, hasReacted: localReacted.has(r.emoji) })),
    flaggedAt: local.flaggedAt,
  }
}

/** Optimistically toggle the caller's reaction with `emoji` on a message,
 *  attributing it to `myName` so the chip's hover tooltip is right immediately
 *  (the mutation's onSuccess then reconciles to the server's canonical list). */
export function toggleReactionLocal(
  m: AgentConversationMessageDTO,
  emoji: string,
  hadReacted: boolean,
  myName: string
): AgentConversationMessageDTO {
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

/** Whether an inbox-stream event changes the conversation LIST's ordering /
 *  preview / unread badge: new + deleted messages, conversation updates, and an
 *  AGENT read move (mark-unread). typing, visitor-read ("Seen"), and
 *  message_updated (reaction/flag) only touch the open thread.
 *
 *  Also covers the ticket-side events (unified inbox §3.2, M3), which share
 *  this one predicate rather than a parallel `eventChangesInboxItemList` since
 *  the unified list is one query either way: `ticket_message` and
 *  `ticket_updated` always refresh (new reply / any property change), and
 *  `ticket_read` only for the assignee (`side: 'agent'`) watermark — a
 *  requester marking their own copy read never moves the agent-facing unread
 *  count (mirrors the conversation `read`/`side` rule above exactly). */
export function agentEventChangesInboxList(evt: ConversationStreamEvent): boolean {
  if (evt.kind === 'ticket_read') return evt.side === 'agent'
  if (evt.kind === 'ticket_message' || evt.kind === 'ticket_updated') return true
  return (
    (evt.kind !== 'read' && evt.kind !== 'typing' && evt.kind !== 'message_updated') ||
    (evt.kind === 'read' && evt.side === 'agent')
  )
}

/** Apply one inbox-stream event to the open agent thread's cache. Events for
 *  other conversations (the inbox stream is multiplexed) and typing return
 *  prev untouched. */
export function applyAgentThreadEvent(
  prev: AgentThreadCache | undefined,
  evt: ConversationStreamEvent,
  conversationId: ConversationId
): AgentThreadCache | undefined {
  if (!prev) return prev
  switch (evt.kind) {
    case 'message':
      if (evt.conversationId !== conversationId) return prev
      if (prev.messages.some((m) => m.id === evt.message.id)) return prev
      return { ...prev, messages: [...prev.messages, asAgentMessage(evt.message)] }
    case 'read': {
      if (evt.conversationId !== conversationId) return prev
      // Advance the read watermark for the relevant side: visitor → the agent's
      // "Seen" updates live; agent → the unread divider repositions (e.g. when
      // another agent marks the thread unread). An unchanged watermark returns
      // prev untouched so subscribers skip a no-op render.
      const field = evt.side === 'visitor' ? 'visitorLastReadAt' : 'agentLastReadAt'
      if (prev.conversation[field] === evt.at) return prev
      return { ...prev, conversation: { ...prev.conversation, [field]: evt.at } }
    }
    case 'message_updated':
      // A reaction or flag changed on an existing message — patch it in place,
      // preserving OUR own hasReacted (the broadcast carries the actor's view).
      // A message outside the loaded page returns prev untouched.
      if (evt.conversationId !== conversationId) return prev
      if (!prev.messages.some((m) => m.id === evt.message.id)) return prev
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === evt.message.id ? mergeAgentMessage(m, evt.message) : m
        ),
      }
    case 'message_deleted':
      if (evt.conversationId !== conversationId) return prev
      return { ...prev, messages: prev.messages.filter((m) => m.id !== evt.messageId) }
    case 'conversation':
      // Keep the open thread in sync with changes another agent made. The agent
      // DTO carries fresh tags too, so a foreign label change propagates here —
      // tag mutations have no dedicated broadcast, so they ride on the next
      // conversation event. Adopting it wholesale can briefly overwrite a tag
      // THIS client just applied locally if a foreign metadata event interleaves;
      // we accept that narrow, self-healing race rather than leave other agents'
      // labels invisible until reload (reliable sync would need a tag broadcast).
      return evt.conversation.id === conversationId
        ? { ...prev, conversation: evt.conversation }
        : prev
    default:
      return prev
  }
}

/** Apply one per-conversation stream event to the visitor thread's cache. The
 *  stream is scoped to a single conversation, so message events carry no id
 *  filter; agent-only message_updated never reaches this stream and is ignored. */
export function applyVisitorThreadEvent(
  prev: VisitorThreadCache | undefined,
  evt: ConversationStreamEvent,
  conversationId: ConversationId
): VisitorThreadCache | undefined {
  if (!prev) return prev
  switch (evt.kind) {
    case 'message':
      if (prev.messages.some((m) => m.id === evt.message.id)) return prev
      return { ...prev, messages: [...prev.messages, evt.message] }
    case 'read':
      return evt.side === 'agent' && prev.agentLastReadAt !== evt.at
        ? { ...prev, agentLastReadAt: evt.at }
        : prev
    case 'message_deleted':
      return { ...prev, messages: prev.messages.filter((m) => m.id !== evt.messageId) }
    case 'conversation':
      return evt.conversation.id === conversationId
        ? { ...prev, status: evt.conversation.status, csatRating: evt.conversation.csatRating }
        : prev
    default:
      return prev
  }
}

/** Merge our own freshly-sent agent message into the thread cache (dedupe by
 *  id — the SSE echo may land first) and adopt the returned conversation. */
export function appendSentAgentMessage(
  prev: AgentThreadCache | undefined,
  res: { conversation: ConversationDTO; message: ConversationMessageDTO }
): AgentThreadCache | undefined {
  return prev && !prev.messages.some((m) => m.id === res.message.id)
    ? {
        ...prev,
        conversation: res.conversation,
        messages: [...prev.messages, asAgentMessage(res.message)],
      }
    : prev
}

/** Merge the visitor's own freshly-sent message: initialize the cache when the
 *  send just created the conversation, otherwise append (deduped) and adopt the
 *  server's status so a reply that reopens a closed thread clears the
 *  "closed / reply to reopen" hint (and its CSAT prompt) immediately. */
export function appendSentVisitorMessage(
  prev: VisitorThreadCache | undefined,
  res: { conversation: { status: ConversationStatus }; message: ConversationMessageDTO }
): VisitorThreadCache {
  if (!prev) {
    return {
      messages: [res.message],
      hasMore: false,
      agentLastReadAt: null,
      status: res.conversation.status,
      csatRating: null,
    }
  }
  return {
    ...prev,
    status: res.conversation.status,
    messages: prev.messages.some((m) => m.id === res.message.id)
      ? prev.messages
      : [...prev.messages, res.message],
  }
}

/** Prepend an older page (keyset backfill) onto a thread cache, keeping only
 *  unknown ids so an overlapping page can't duplicate rows. `mapMessage`
 *  coerces rows for caches with a richer message type. */
function prependOlder<T extends ConversationMessageDTO, C extends { messages: T[] }>(
  prev: C,
  page: MessagePage,
  mapMessage?: (m: ConversationMessageDTO) => T
): C & { hasMore: boolean } {
  const known = new Set(prev.messages.map((m) => m.id))
  const unknown = page.messages.filter((m) => !known.has(m.id))
  const older = mapMessage ? unknown.map(mapMessage) : (unknown as T[])
  return { ...prev, messages: [...older, ...prev.messages], hasMore: page.hasMore }
}

/** Prepend an older agent page, coercing rows to the agent DTO. */
export function prependOlderAgentMessages(
  prev: AgentThreadCache | undefined,
  page: MessagePage
): AgentThreadCache | undefined {
  return prev ? prependOlder(prev, page, asAgentMessage) : prev
}

/** Prepend an older visitor page, deduped like the agent side. */
export function prependOlderVisitorMessages(
  prev: VisitorThreadCache | undefined,
  page: MessagePage
): VisitorThreadCache | undefined {
  return prev ? prependOlder(prev, page) : prev
}

/** Patch one message in a thread cache (optimistic updates + server
 *  reconciliation for reactions and flags) — generic over the cache shape,
 *  following `prependOlder<T,C>`'s pattern. */
function updateThreadMessage<C extends { messages: AgentConversationMessageDTO[] }>(
  prev: C | undefined,
  messageId: ConversationMessageId,
  update: (m: AgentConversationMessageDTO) => AgentConversationMessageDTO
): C | undefined {
  if (!prev) return prev
  return { ...prev, messages: prev.messages.map((m) => (m.id === messageId ? update(m) : m)) }
}

/** Drop one message from a thread cache (after a delete) — generic, mirrors
 *  `updateThreadMessage`. */
function removeThreadMessage<C extends { messages: AgentConversationMessageDTO[] }>(
  prev: C | undefined,
  messageId: ConversationMessageId
): C | undefined {
  if (!prev) return prev
  return { ...prev, messages: prev.messages.filter((m) => m.id !== messageId) }
}

/** Patch one message in the agent thread cache. */
export function updateAgentThreadMessage(
  prev: AgentThreadCache | undefined,
  messageId: ConversationMessageId,
  update: (m: AgentConversationMessageDTO) => AgentConversationMessageDTO
): AgentThreadCache | undefined {
  return updateThreadMessage(prev, messageId, update)
}

/** Drop one message from the agent thread cache (after a delete). */
export function removeAgentThreadMessage(
  prev: AgentThreadCache | undefined,
  messageId: ConversationMessageId
): AgentThreadCache | undefined {
  return removeThreadMessage(prev, messageId)
}

// ---------------------------------------------------------------------------
// Ticket thread (unified inbox §3.2, M3)
// ---------------------------------------------------------------------------

/** The ticket thread cache (unified inbox §2.5, M4): messages are
 *  AgentConversationMessageDTO too, same as the conversation cache — a ticket
 *  message now carries reactions/flags (the M4 fold gave it the same message-
 *  level actions a conversation message has). No `conversation`-shaped field
 *  to patch, though: a ticket's properties (status, assignee, priority...)
 *  live in the separate `inboxQueries.ticketDetail`/`ticketQueries.list`
 *  caches, not this one — so `applyTicketThreadEvent` only ever has a
 *  `ticket_message` to react to (`ticket_updated`/`ticket_read` have nothing
 *  here to patch). */
export interface TicketThreadCache {
  messages: AgentConversationMessageDTO[]
  hasMore: boolean
}

/** Apply one ticket-stream event to an open ticket thread's cache. Events for
 *  other tickets (the inbox stream is multiplexed, and a ticket's own stream
 *  only ever carries its own events anyway) and any non-`ticket_message` kind
 *  return prev untouched — `ticket_updated`/`ticket_read` have nothing in this
 *  cache to patch (see the type doc above). Ticket-parented reactions/flags
 *  don't broadcast yet (no `ticket_message_updated` stream event — deferred,
 *  see message.actions.ts), so unlike the conversation side there is no
 *  `message_updated`/`message_deleted` case to handle here.*/
export function applyTicketThreadEvent(
  prev: TicketThreadCache | undefined,
  evt: ConversationStreamEvent,
  ticketId: TicketId
): TicketThreadCache | undefined {
  if (!prev) return prev
  if (evt.kind !== 'ticket_message') return prev
  if (evt.ticketId !== ticketId) return prev
  if (prev.messages.some((m) => m.id === evt.message.id)) return prev
  return { ...prev, messages: [...prev.messages, asAgentMessage(evt.message)] }
}

/** Merge our own freshly-sent ticket message into the thread cache (dedupe by
 *  id — the SSE echo may land first). Mirrors `appendSentAgentMessage` minus
 *  the conversation-adoption step this cache has no field for. */
export function appendSentTicketMessage(
  prev: TicketThreadCache | undefined,
  res: { message: ConversationMessageDTO }
): TicketThreadCache | undefined {
  return prev && !prev.messages.some((m) => m.id === res.message.id)
    ? { ...prev, messages: [...prev.messages, asAgentMessage(res.message)] }
    : prev
}

/** Prepend an older ticket page, coercing rows to the agent DTO (mirrors
 *  `prependOlderAgentMessages`). */
export function prependOlderTicketMessages(
  prev: TicketThreadCache | undefined,
  page: MessagePage
): TicketThreadCache | undefined {
  return prev ? prependOlder(prev, page, asAgentMessage) : prev
}

/** Patch one message in the ticket thread cache (optimistic updates + server
 *  reconciliation for reactions and flags — mirrors `updateAgentThreadMessage`). */
export function updateTicketThreadMessage(
  prev: TicketThreadCache | undefined,
  messageId: ConversationMessageId,
  update: (m: AgentConversationMessageDTO) => AgentConversationMessageDTO
): TicketThreadCache | undefined {
  return updateThreadMessage(prev, messageId, update)
}

/** Drop one message from the ticket thread cache (after a delete). */
export function removeTicketThreadMessage(
  prev: TicketThreadCache | undefined,
  messageId: ConversationMessageId
): TicketThreadCache | undefined {
  return removeThreadMessage(prev, messageId)
}
