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
import type { ChatStreamEvent, ConversationDTO } from '@/lib/shared/chat/types'
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
 * Publish an agent typing signal. The visitor's channel gets an anonymous
 * "agent is typing" (NO principal id — never leak who is on the team side); the
 * inbox channel gets the id so other agents can detect a collision. The
 * originating agent's own echo is suppressed at the stream layer
 * (shouldSuppressOwnAgentTyping).
 */
export function publishAgentTyping(
  conversationId: ConversationId,
  at: string,
  agentPrincipalId: PrincipalId
): void {
  publish(conversationChannel(conversationId), {
    kind: 'typing',
    conversationId,
    side: 'agent',
    at,
  })
  publish(CHAT_INBOX_CHANNEL, {
    kind: 'typing',
    conversationId,
    side: 'agent',
    at,
    agentPrincipalId,
  })
}

/**
 * True when a raw pub/sub frame is an agent-typing event from `selfPrincipalId`
 * — used by the inbox stream to drop an agent's own typing echo so the client
 * can treat any agent-typing it receives as "another agent". Unparseable or
 * non-matching frames are never suppressed.
 */
export function shouldSuppressOwnAgentTyping(message: string, selfPrincipalId: string): boolean {
  try {
    const e = JSON.parse(message) as {
      kind?: string
      side?: string
      agentPrincipalId?: string
    }
    return e.kind === 'typing' && e.side === 'agent' && e.agentPrincipalId === selfPrincipalId
  } catch {
    return false
  }
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
