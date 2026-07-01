/**
 * Client-safe live chat types, shared by the widget view, the admin inbox, and
 * the SSE transport. No server-only imports here — this module is bundled into
 * the browser.
 */
import type { ConversationId, ChatMessageId, ChatTagId, PrincipalId } from '@quackback/ids'

// Sourced from the DB enum (CONVERSATION_STATUSES) via the browser-safe bridge,
// so the client type can never drift from the column's allowed values. Imported
// locally (used below) and re-exported for the module's consumers.
import type {
  ConversationStatus,
  ChatSystemEvent,
  TiptapContent,
  ConversationEndReason,
} from '@/lib/shared/db-types'
import { CONVERSATION_END_REASONS } from '@/lib/shared/db-types'
export type { ConversationStatus, ChatSystemEvent, ConversationEndReason }
export { CONVERSATION_END_REASONS }
export type ConversationPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'
// 'system' = a status event (e.g. assignment) shown to both sides, rendered as
// a centered notice rather than a chat bubble.
export type MessageSenderType = 'visitor' | 'agent' | 'system'
/** A human side of a conversation — who acts (types, reads); 'system' is neither. */
export type ConversationSide = Exclude<MessageSenderType, 'system'>
/** How a conversation arrived — mirrors the conversations.channel column enum. */
export type Channel = 'messenger' | 'email' | 'web_form'

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

/** A conversation label ("tag") as surfaced to the inbox. Agent-only. */
export interface ChatTagDTO {
  id: ChatTagId
  name: string
  color: string
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
  senderType: MessageSenderType
  content: string
  createdAt: string
  /** Null for system events, which have no human author. */
  author: ChatAuthorDTO | null
  attachments: ChatAttachment[]
  /** Agent-only internal note — only ever present on agent-facing payloads. */
  isInternal: boolean
  /** Rich TipTap doc for messages that carry structured content: internal-note
   *  @-mention chips, and rich agent replies / visitor messages from the rich
   *  composer (inline embeds + images). Null for plain live-chat/email messages,
   *  which render from `content`. Sanitized on write. */
  contentJson: TiptapContent | null
  /** True when this message arrived via the email channel (inbound reply). */
  viaEmail: boolean
  /** Structured event for a 'system' message, so clients can localize it; null
   *  for ordinary messages (and legacy system rows, which fall back to content). */
  systemEvent: ChatSystemEvent | null
}

/** One emoji reaction bucket on a message. `hasReacted` is viewer-relative
 *  (structurally identical to the comment-domain CommentReactionCount). */
export interface MessageReactionCount {
  emoji: string
  count: number
  hasReacted: boolean
  /** Display names of who reacted (capped), for the hover tooltip. May be empty
   *  on optimistic updates until the server reconciles. */
  reactors?: string[]
}

/**
 * A chat message as surfaced to an AGENT, extending the base DTO with
 * agent-only fields. These MUST NOT reach the visitor: they are populated only
 * by `enrichMessagesForAgent` (never by the shared `toMessageDTO`), and the one
 * realtime event that carries them (`message_updated`) is published on the
 * inbox channel only. Keeping them off `ChatMessageDTO` means any visitor-facing
 * function returning `ChatMessageDTO[]` fails to compile if it tries to expose
 * them.
 */
export interface AgentChatMessageDTO extends ChatMessageDTO {
  /** Emoji reactions, aggregated with the requesting agent's `hasReacted`. */
  reactions: MessageReactionCount[]
  /** ISO timestamp when this message was flagged for the team, or null. */
  flaggedAt: string | null
  /** Agent-only AI suggestion to track this conversation as a post; null
   *  otherwise. Never on the base DTO, so it never reaches the visitor. */
  postSuggestion: { boardId: string; title: string; content: string } | null
}

/** A flagged ("Saved for later") message for the per-agent saved feed: enough
 *  to preview it and jump to its conversation. */
export interface FlaggedMessageDTO {
  messageId: ChatMessageId
  conversationId: ConversationId
  /** Plain-text preview of the flagged message. */
  preview: string
  /** Who wrote the flagged message. */
  authorName: string | null
  /** The conversation's visitor (so the list reads "in <conversation>"). */
  conversationLabel: string | null
  flaggedAt: string
}

/** A conversation row as surfaced to clients (inbox list + thread header). */
export interface ConversationDTO {
  id: ConversationId
  status: ConversationStatus
  /** Agent-set triage priority ('none' = unset). */
  priority: ConversationPriority
  /** The channel the conversation arrived on ('messenger' for widget threads). */
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
  /** Why the conversation was ended (from CONVERSATION_END_REASONS), or null when
   *  it was never ended (or ended before this was captured). Shown on both sides
   *  so a closed thread can display its outcome. */
  endReason: ConversationEndReason | null
  /** Agent-only free-text note left when ending the conversation; null otherwise.
   *  Stripped on visitor-facing payloads. */
  endNote: string | null
  /** Conversation labels (agent-managed); empty when untagged. Agent-only. */
  tags: ChatTagDTO[]
}

/** Human labels for each end reason, for the end-conversation dialog + the
 *  closed-thread summary. Kept beside the taxonomy so the two never drift. */
export const CONVERSATION_END_REASON_LABELS: Record<ConversationEndReason, string> = {
  resolved: 'Resolved',
  tracked_as_feedback: 'Tracked as feedback',
  duplicate: 'Duplicate / already handled',
  no_response: 'No response from customer',
  spam: 'Spam / not actionable',
  other: 'Other',
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
      side: MessageSenderType
      at: string
    }
  | {
      // Ephemeral typing signal — never persisted, just fanned out over pub/sub.
      kind: 'typing'
      conversationId: ConversationId
      side: MessageSenderType
      at: string
      /** Who is typing. Set everywhere EXCEPT the conversation-channel copy of
       *  agent typing (never leak team identities to the visitor). The stream
       *  layer drops any typing event whose typist matches the subscriber, so
       *  no surface ever sees its own echo; agents also use it to tell another
       *  agent's typing from their own collisions. */
      typistPrincipalId?: PrincipalId
    }
  | { kind: 'message_deleted'; conversationId: ConversationId; messageId: ChatMessageId }
  // An existing message changed in an agent-only way (reaction or flag toggled).
  // Carries the enriched AgentChatMessageDTO and is published on the inbox
  // channel ONLY (publishAgentChatEvent) — it never reaches the visitor.
  | { kind: 'message_updated'; conversationId: ConversationId; message: AgentChatMessageDTO }

/** Hard caps shared by client + server validation. */
export const MAX_CHAT_MESSAGE_LENGTH = 4000
export const MAX_CHAT_ATTACHMENTS = 10
