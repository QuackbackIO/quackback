/**
 * Client-safe live chat types, shared by the widget view, the admin inbox, and
 * the SSE transport. No server-only imports here — this module is bundled into
 * the browser.
 */
import type { ConversationId, ChatMessageId, PrincipalId } from '@quackback/ids'

export type ConversationStatus = 'open' | 'snoozed' | 'pending' | 'closed'
export type ConversationPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'
// 'system' = a status event (e.g. assignment) shown to both sides, rendered as
// a centered notice rather than a chat bubble.
export type ChatSenderType = 'visitor' | 'agent' | 'system'
/** How a conversation arrived — mirrors the conversations.channel column enum. */
export type Channel = 'live_chat' | 'email' | 'web_form'

/** One weekday's availability window, local to the config timezone. */
export interface OfficeHoursDay {
  /** Whether the team is available this weekday. */
  enabled: boolean
  /** Local open time, "HH:mm" (24-hour). */
  start: string
  /** Local close time, "HH:mm" (24-hour). */
  end: string
}

/** Weekly office hours used to set visitor expectations in the widget. */
export interface OfficeHoursConfig {
  enabled: boolean
  /** IANA timezone the ranges are expressed in (e.g. "America/New_York"). */
  timezone: string
  /** Seven entries, index 0 = Sunday … 6 = Saturday. */
  days: OfficeHoursDay[]
}

/** Pre-chat email capture mode for anonymous visitors. */
export type PreChatEmailMode = 'off' | 'optional' | 'required'

/** Author identity attached to a rendered message. */
export interface ChatAuthorDTO {
  principalId: PrincipalId
  displayName: string | null
  avatarUrl: string | null
}

/** An image/file attachment ref on a message (URL from the upload pipeline). */
export interface ChatAttachment {
  url: string
  name: string
  contentType: string
  size: number
}

/** A single rendered chat message. `createdAt` is an ISO-8601 string. */
export interface ChatMessageDTO {
  id: ChatMessageId
  conversationId: ConversationId
  senderType: ChatSenderType
  content: string
  createdAt: string
  /** Null for system events, which have no human author. */
  author: ChatAuthorDTO | null
  attachments: ChatAttachment[]
  /** Agent-only internal note — only ever present on agent-facing payloads. */
  isInternal: boolean
  /** True when this message arrived via the email channel (inbound reply). */
  viaEmail: boolean
}

/** A conversation row as surfaced to clients (inbox list + thread header). */
export interface ConversationDTO {
  id: ConversationId
  status: ConversationStatus
  /** Agent-set triage priority ('none' = unset). */
  priority: ConversationPriority
  /** The channel the conversation arrived on ('live_chat' for widget threads). */
  channel: Channel
  subject: string | null
  lastMessagePreview: string | null
  lastMessageAt: string
  createdAt: string
  visitor: ChatAuthorDTO
  assignedAgent: ChatAuthorDTO | null
  /** Unread count for the side that requested it (0 when fully read). */
  unreadCount: number
  /** Read-receipt watermarks (ISO) used to render a "Seen" state. */
  visitorLastReadAt: string | null
  agentLastReadAt: string | null
  /** Post-conversation CSAT rating (1-5), or null if not yet rated. */
  csatRating: number | null
  /** Captured contact email for an anonymous visitor; agent-only, null otherwise. */
  visitorEmail: string | null
  /** When the conversation was resolved/closed (ISO), or null while still active. */
  resolvedAt: string | null
}

/**
 * Events streamed over SSE. Every event names its conversation so a single
 * inbox stream can route across many threads. `message` events carry an
 * `id:` line equal to the message id for Last-Event-ID backfill.
 */
export type ChatStreamEvent =
  | { kind: 'message'; conversationId: ConversationId; message: ChatMessageDTO }
  | { kind: 'conversation'; conversation: ConversationDTO }
  | {
      kind: 'read'
      conversationId: ConversationId
      side: ChatSenderType
      at: string
    }
  | {
      // Ephemeral typing signal — never persisted, just fanned out over pub/sub.
      kind: 'typing'
      conversationId: ConversationId
      side: ChatSenderType
      at: string
      /** For agent typing: which agent (inbox channel only — never sent to the
       *  visitor). Lets other agents detect a collision; the originating agent's
       *  own echo is filtered server-side. */
      agentPrincipalId?: PrincipalId
    }
  | { kind: 'message_deleted'; conversationId: ConversationId; messageId: ChatMessageId }

/** Hard caps shared by client + server validation. */
export const MAX_CHAT_MESSAGE_LENGTH = 4000
export const MAX_CHAT_ATTACHMENTS = 10
