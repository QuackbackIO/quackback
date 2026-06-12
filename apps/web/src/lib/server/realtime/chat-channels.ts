/**
 * Channel naming + publish helpers for conversation real-time delivery.
 *
 * Two channels per workspace process:
 *   - per-conversation: the visitor of that conversation subscribes here.
 *   - inbox: every agent subscribes here for cross-conversation updates.
 *
 * A new message is published to BOTH so the visitor's thread and every
 * agent's inbox update at once. Clients dedupe by message id.
 */
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ChatStreamEvent, ConversationDTO, ConversationSide } from '@/lib/shared/chat/types'
import { publish } from './pubsub'

export function conversationChannel(conversationId: ConversationId): string {
  return `chat:conv:${conversationId}`
}

/** Single shared channel all agents listen on for inbox-wide updates. */
export const CHAT_INBOX_CHANNEL = 'chat:inbox'

/** Publish a stream event to the conversation channel + the agent inbox. */
export function publishChatEvent(conversationId: ConversationId, event: ChatStreamEvent): void {
  publish(conversationChannel(conversationId), event)
  publish(CHAT_INBOX_CHANNEL, event)
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
  publish(CHAT_INBOX_CHANNEL, tagged)
}

/** A pub/sub frame parsed for routing decisions; null when unparseable. */
export type ParsedChatFrame = {
  kind?: string
  typistPrincipalId?: string
  message?: { id?: string }
} | null

export function parseChatFrame(message: string): ParsedChatFrame {
  try {
    return JSON.parse(message) as ParsedChatFrame
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
export function isOwnTyping(frame: ParsedChatFrame, selfPrincipalId: string): boolean {
  return frame?.kind === 'typing' && frame.typistPrincipalId === selfPrincipalId
}

/**
 * Publish an agent-only event to the inbox channel ONLY (never the
 * conversation channel the visitor subscribes to) — used for internal notes.
 */
export function publishAgentChatEvent(event: ChatStreamEvent): void {
  publish(CHAT_INBOX_CHANNEL, event)
}

/**
 * Publish a conversation update to both channels with audience-appropriate
 * payloads: agents get the full DTO on the inbox channel, while the visitor's
 * conversation channel receives a copy with every agent-only field stripped
 * (the captured email + the internal labels). Keep this list in sync with the
 * agent-only fields on ConversationDTO so a new one can never silently reach the
 * visitor (chat-channels.test.ts pins this).
 */
export function publishConversationUpdate(
  conversationId: ConversationId,
  agentDto: ConversationDTO
): void {
  publish(CHAT_INBOX_CHANNEL, { kind: 'conversation', conversation: agentDto })
  publish(conversationChannel(conversationId), {
    kind: 'conversation',
    conversation: { ...agentDto, visitorEmail: null, tags: [], endNote: null },
  })
}
