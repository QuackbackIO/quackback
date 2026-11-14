/**
 * Channel naming + publish helpers for conversation real-time delivery.
 *
 * Two channels per workspace process:
 *   - per-conversation: the visitor of that conversation subscribes here.
 *   - inbox: every agent subscribes here for cross-conversation updates.
 *
 * A new message is published to BOTH so the visitor's thread and every
 * agent's inbox update at once. Clients dedupe by message id.
 *
 * Tickets (unified inbox §3.2, M3) get their own per-ticket channel
 * (`ticketChannel`) alongside the SAME shared inbox channel above — there is
 * no ticket analogue of `publishConversationUpdate`'s visitor-stripped copy,
 * because a ticket stream is team-member-only in this phase (see
 * routes/api/chat/stream.ts's `ticketId` scope gate): both channels a ticket
 * event reaches are agent audiences, so the full event is safe on both.
 *
 * Every inbox copy goes through `publishInboxFrame` (inbox-publish.ts), which
 * attaches the item's scope envelope on the wire so the inbox stream sends it
 * only to teammates whose scope holds the item. Each publisher takes the
 * envelope as an optional trailing parameter; without it the item's owner and
 * team are read by id. The visitor and per-ticket copies never carry it.
 */
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'
import type {
  ConversationStreamEvent,
  ConversationDTO,
  ConversationMessageDTO,
  ConversationSide,
} from '@/lib/shared/conversation/types'
import { publish } from './pubsub'
import { CONVERSATION_INBOX_CHANNEL, publishInboxFrame } from './inbox-publish'
import type { InboxItemScope } from './inbox-envelope'
import type { ScopedRow } from '@/lib/server/policy/row-scope'
import { loadAuthors, fallbackAuthor } from '@/lib/server/domains/principals/principal-display'

export function conversationChannel(conversationId: ConversationId): string {
  return `conversation:${conversationId}`
}

// Single shared channel all agents listen on for inbox-wide updates; defined
// beside the one publish that may write to it.
export { CONVERSATION_INBOX_CHANNEL }

/** Publish a stream event to the conversation channel + the agent inbox. */
export function publishConversationEvent(
  conversationId: ConversationId,
  event: ConversationStreamEvent,
  envelope?: InboxItemScope
): void {
  publish(conversationChannel(conversationId), event)
  publishInboxFrame({ kind: 'conversation', id: conversationId }, event, envelope)
}

/**
 * A new message on both channels, with a different author label per audience.
 * The visitor's channel keeps the public name. The inbox copy may carry the
 * account name. Omit `agent` to send the same payload to both.
 *
 * `conversationUpdated` says the same write also sent the conversation's own
 * update (publishConversationUpdate). The inbox list refreshes on that event,
 * so the inbox copy of the message says it need not refresh again.
 */
export function publishConversationMessage(
  conversationId: ConversationId,
  messages: { visitor: ConversationMessageDTO; agent?: ConversationMessageDTO },
  opts?: { conversationUpdated?: boolean; envelope?: InboxItemScope }
): void {
  publish(conversationChannel(conversationId), {
    kind: 'message',
    conversationId,
    message: messages.visitor,
  })
  publishInboxFrame(
    { kind: 'conversation', id: conversationId },
    {
      kind: 'message',
      conversationId,
      message: messages.agent ?? messages.visitor,
      ...(opts?.conversationUpdated ? { conversationUpdated: true } : {}),
    },
    opts?.envelope
  )
}

/**
 * Publish a typing signal, tagging each copy with the typist where it's safe:
 * the inbox channel always gets the id (self-suppression + agent collision
 * detection); the conversation channel gets it only for visitor-side typing —
 * there the id is the owner's own, while agent identities must never reach the
 * visitor. The typist's own echo is dropped at the stream layer on every
 * surface (isOwnTyping).
 */
export function publishTyping(
  conversationId: ConversationId,
  side: ConversationSide,
  at: string,
  // null (no principal to attribute) publishes untagged — delivered to all, suppressed for none.
  typistPrincipalId: PrincipalId | null,
  envelope?: InboxItemScope
): void {
  const base = { kind: 'typing' as const, conversationId, side, at }
  const tagged = typistPrincipalId ? { ...base, typistPrincipalId } : base
  // Agent identities never reach the visitor channel; a visitor-side id is the
  // owner's own, so it can ride along there.
  publish(conversationChannel(conversationId), side === 'agent' ? base : tagged)
  publishInboxFrame({ kind: 'conversation', id: conversationId }, tagged, envelope)
}

/** A pub/sub frame parsed for routing decisions; null when unparseable. */
export type ParsedConversationFrame = {
  kind?: string
  typistPrincipalId?: string
  message?: { id?: string }
} | null

export function parseConversationFrame(message: string): ParsedConversationFrame {
  try {
    return JSON.parse(message) as ParsedConversationFrame
  } catch {
    return null
  }
}

/**
 * True when a parsed frame is a typing event from `selfPrincipalId` — used by
 * every stream to drop the subscriber's own typing echo, so clients can treat
 * any typing they receive as someone else's. Unparseable, anonymous, or
 * non-matching frames are never suppressed.
 */
export function isOwnTyping(frame: ParsedConversationFrame, selfPrincipalId: string): boolean {
  return frame?.kind === 'typing' && frame.typistPrincipalId === selfPrincipalId
}

/**
 * Publish an agent-only event to the inbox channel ONLY (never the
 * conversation channel the visitor subscribes to) — used for internal notes.
 * The item is the event's conversation; an event that names none (the type
 * admits ticket kinds) is dropped and logged.
 */
export function publishAgentConversationEvent(
  event: ConversationStreamEvent,
  envelope?: InboxItemScope
): void {
  const conversationId =
    event.kind === 'conversation'
      ? event.conversation.id
      : 'conversationId' in event
        ? event.conversationId
        : null
  publishInboxFrame(
    conversationId ? { kind: 'conversation', id: conversationId } : null,
    event,
    envelope
  )
}

/**
 * Publish an ephemeral event to the conversation channel ONLY (never the inbox).
 * Used for the AI assistant's high-frequency turn signals (working status +
 * streamed deltas): the visitor's live trace needs them, but fanning them to the
 * inbox would churn every agent's list on each fragment.
 */
export function publishConversationOnlyEvent(
  conversationId: ConversationId,
  event: ConversationStreamEvent
): void {
  publish(conversationChannel(conversationId), event)
}

/**
 * Publish a conversation update to both channels with audience-appropriate
 * payloads: agents get the full DTO on the inbox channel, while the visitor's
 * conversation channel receives a copy with every agent-only field stripped
 * (the captured email, the internal labels, the SLA clocks). Keep this list in
 * sync with the agent-only fields on ConversationDTO so a new one can never
 * silently reach the visitor (conversation-channels.test.ts pins this).
 */
export async function publishConversationUpdate(
  conversationId: ConversationId,
  agentDto: ConversationDTO,
  opts?: { prev?: ScopedRow }
): Promise<void> {
  // Reuse the public profile loader: agent DTOs may contain account names.
  const authors = await loadAuthors([
    agentDto.visitor.principalId,
    agentDto.assignedAgent?.principalId,
  ])
  // The DTO is the row just written, so it is its own envelope. A writer that
  // can move the item out of someone's scope passes what it was before.
  publishInboxFrame(
    { kind: 'conversation', id: conversationId },
    { kind: 'conversation', conversation: agentDto },
    {
      assigneePrincipalId: agentDto.assignedAgent?.principalId ?? null,
      teamId: agentDto.assignedTeamId ?? null,
      ...(opts?.prev ? { prev: opts.prev } : {}),
    }
  )
  publish(conversationChannel(conversationId), {
    kind: 'conversation',
    conversation: {
      ...agentDto,
      visitor:
        authors.get(agentDto.visitor.principalId) ?? fallbackAuthor(agentDto.visitor.principalId),
      assignedAgent: agentDto.assignedAgent
        ? (authors.get(agentDto.assignedAgent.principalId) ??
          fallbackAuthor(agentDto.assignedAgent.principalId))
        : null,
      visitorEmail: null,
      tags: [],
      endNote: null,
      sla: null,
      snoozedUntil: null,
      assignedTeamId: null,
      customAttributes: {},
      translation: null,
      spamReason: null,
    },
  })
}

/** `ticket:<id>` — the channel a ticket's own stream subscribes to (team members only). */
export function ticketChannel(ticketId: TicketId): string {
  return `ticket:${ticketId}`
}

/**
 * Publish a ticket stream event to the ticket's own channel + the shared
 * inbox channel, so an open ticket detail view and every team member's inbox
 * update from the same push. Unlike `publishConversationEvent` there is no
 * audience-stripped copy — see the file-header note on why that's safe here.
 */
export function publishTicketEvent(
  ticketId: TicketId,
  event: ConversationStreamEvent,
  envelope?: InboxItemScope
): void {
  publish(ticketChannel(ticketId), event)
  publishInboxFrame({ kind: 'ticket', id: ticketId }, event, envelope)
}
