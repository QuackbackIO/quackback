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
 */
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'
import type {
  ConversationStreamEvent,
  ConversationDTO,
  ConversationSide,
} from '@/lib/shared/conversation/types'
import { publish } from './pubsub'

export function conversationChannel(conversationId: ConversationId): string {
  return `conversation:${conversationId}`
}

/** Single shared channel all agents listen on for inbox-wide updates. */
export const CONVERSATION_INBOX_CHANNEL = 'conversation:inbox'

/** Publish a stream event to the conversation channel + the agent inbox. */
export function publishConversationEvent(
  conversationId: ConversationId,
  event: ConversationStreamEvent
): void {
  publish(conversationChannel(conversationId), event)
  publish(CONVERSATION_INBOX_CHANNEL, event)
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
  typistPrincipalId: PrincipalId | null
): void {
  const base = { kind: 'typing' as const, conversationId, side, at }
  const tagged = typistPrincipalId ? { ...base, typistPrincipalId } : base
  // Agent identities never reach the visitor channel; a visitor-side id is the
  // owner's own, so it can ride along there.
  publish(conversationChannel(conversationId), side === 'agent' ? base : tagged)
  publish(CONVERSATION_INBOX_CHANNEL, tagged)
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
 */
export function publishAgentConversationEvent(event: ConversationStreamEvent): void {
  publish(CONVERSATION_INBOX_CHANNEL, event)
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
export function publishConversationUpdate(
  conversationId: ConversationId,
  agentDto: ConversationDTO
): void {
  publish(CONVERSATION_INBOX_CHANNEL, { kind: 'conversation', conversation: agentDto })
  publish(conversationChannel(conversationId), {
    kind: 'conversation',
    conversation: { ...agentDto, visitorEmail: null, tags: [], endNote: null, sla: null },
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
export function publishTicketEvent(ticketId: TicketId, event: ConversationStreamEvent): void {
  publish(ticketChannel(ticketId), event)
  publish(CONVERSATION_INBOX_CHANNEL, event)
}
