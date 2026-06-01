/**
 * Channel naming + publish helpers for live chat real-time delivery.
 *
 * Two channels per workspace process:
 *   - per-conversation: the visitor of that conversation subscribes here.
 *   - inbox: every agent subscribes here for cross-conversation updates.
 *
 * A new message is published to BOTH so the visitor's thread and every
 * agent's inbox update at once. Clients dedupe by message id.
 */
import type { ConversationId } from '@quackback/ids'
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
 * (captured email + internal triage tags). Keep this list in sync with the
 * agent-only fields on ConversationDTO so a new one can never silently reach
 * the visitor (chat-channels.test.ts pins this).
 */
export function publishConversationUpdate(
  conversationId: ConversationId,
  agentDto: ConversationDTO
): void {
  publish(CHAT_INBOX_CHANNEL, { kind: 'conversation', conversation: agentDto })
  publish(conversationChannel(conversationId), {
    kind: 'conversation',
    conversation: { ...agentDto, visitorEmail: null, tags: [] },
  })
}
