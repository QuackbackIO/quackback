/**
 * Client-safe conversation types, shared by the widget view, the admin inbox, and
 * the SSE transport. No server-only imports here — this module is bundled into
 * the browser.
 */
import type {
  ConversationId,
  ConversationMessageId,
  ConversationTagId,
  PrincipalId,
  TicketId,
} from '@quackback/ids'

// Sourced from the DB enum (CONVERSATION_STATUSES) via the browser-safe bridge,
// so the client type can never drift from the column's allowed values. Imported
// locally (used below) and re-exported for the module's consumers.
import type {
  ConversationStatus,
  ConversationSystemEvent,
  TiptapContent,
  ConversationEndReason,
} from '@/lib/shared/db-types'
import { CONVERSATION_END_REASONS } from '@/lib/shared/db-types'
export type { ConversationStatus, ConversationSystemEvent, ConversationEndReason }
export { CONVERSATION_END_REASONS }
export type ConversationPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'
// 'system' = a status event (e.g. assignment) shown to both sides, rendered as
// a centered notice rather than a message bubble.
export type MessageSenderType = 'visitor' | 'agent' | 'system'
/** A human side of a conversation — who acts (types, reads); 'system' is neither. */
export type ConversationSide = Exclude<MessageSenderType, 'system'>
/** How a conversation arrived — mirrors the conversations.channel column enum. */
export type Channel = 'messenger' | 'email' | 'web_form'

/**
 * @deprecated Migration-only shape. One weekday's availability window in the
 * released `widgetConfig.messenger.officeHours`. The live model is the interval
 * schedule in `@/lib/shared/office-hours`.
 */
export interface OfficeHoursDay {
  /** Whether the team is available this weekday. */
  enabled: boolean
  /** Local open time, "HH:mm" (24-hour). */
  start: string
  /** Local close time, "HH:mm" (24-hour). */
  end: string
}

/**
 * @deprecated Migration-only shape (see {@link OfficeHoursDay}). Retained only to
 * type stored legacy config for the read-time fallback in settings.office-hours.ts.
 */
export interface OfficeHoursConfig {
  enabled: boolean
  /** IANA timezone the ranges are expressed in (e.g. "America/New_York"). */
  timezone: string
  /** Seven entries, index 0 = Sunday … 6 = Saturday. */
  days: OfficeHoursDay[]
}

/** Pre-chat email capture mode for anonymous visitors. */

/** Author identity attached to a rendered message. */
export interface ConversationAuthorDTO {
  principalId: PrincipalId
  displayName: string | null
  avatarUrl: string | null
}

/** A conversation label ("tag") as surfaced to the inbox. Agent-only. */
export interface ConversationTagDTO {
  id: ConversationTagId
  name: string
  color: string
}

/** An image/file attachment ref on a message (URL from the upload pipeline). */
export interface ConversationAttachment {
  url: string
  name: string
  contentType: string
  size: number
}

/** A KB source the AI assistant grounded a reply in. The message `content`
 *  carries inline [n] markers that index into this ordered list. */
export interface ConversationMessageCitation {
  type: 'article' | 'post'
  id: string
  title: string
  url: string
}

/** A single rendered conversation message. `createdAt` is an ISO-8601 string. */
export interface ConversationMessageDTO {
  id: ConversationMessageId
  /** The conversation this message belongs to, or null when it hangs off a
   *  ticket instead (support platform §4.2). Exactly one of conversationId /
   *  ticketId is set. */
  conversationId: ConversationId | null
  /** The ticket this message belongs to, or null for a conversation message. */
  ticketId: TicketId | null
  senderType: MessageSenderType
  content: string
  createdAt: string
  /** Null for system events, which have no human author. */
  author: ConversationAuthorDTO | null
  attachments: ConversationAttachment[]
  /** KB sources for an AI assistant reply, indexed by inline [n] markers in
   *  `content`. Empty for human/visitor messages. Safe for both audiences. */
  citations: ConversationMessageCitation[]
  /** True when this message was authored by the AI assistant (Quinn). Lets the
   *  agent inbox mark AI vs human turns in a blended thread; the customer widget
   *  ignores it. */
  isAssistant: boolean
  /** Agent-only internal note — only ever present on agent-facing payloads. */
  isInternal: boolean
  /** Rich TipTap doc for messages that carry structured content: internal-note
   *  @-mention chips, and rich agent replies / visitor messages from the rich
   *  composer (inline embeds + images). Null for plain messenger/email messages,
   *  which render from `content`. Sanitized on write. */
  contentJson: TiptapContent | null
  /** True when this message arrived via the email channel (inbound reply). */
  viaEmail: boolean
  /** Structured event for a 'system' message, so clients can localize it; null
   *  for ordinary messages (and legacy system rows, which fall back to content). */
  systemEvent: ConversationSystemEvent | null
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
 * A conversation message as surfaced to an AGENT, extending the base DTO with
 * agent-only fields. These MUST NOT reach the visitor: they are populated only
 * by `enrichMessagesForAgent` (never by the shared `toMessageDTO`), and the one
 * realtime event that carries them (`message_updated`) is published on the
 * inbox channel only. Keeping them off `ConversationMessageDTO` means any visitor-facing
 * function returning `ConversationMessageDTO[]` fails to compile if it tries to expose
 * them.
 */
export interface AgentConversationMessageDTO extends ConversationMessageDTO {
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
  messageId: ConversationMessageId
  /** Parent thread of the flagged message; exactly one is set. */
  conversationId: ConversationId | null
  ticketId: TicketId | null
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
  visitor: ConversationAuthorDTO
  assignedAgent: ConversationAuthorDTO | null
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
  /** When a snoozed conversation wakes (ISO); null when snoozed "until they
   *  reply" or not snoozed. Agent-only — the snooze queue is invisible to the
   *  visitor, so this is stripped on visitor-facing payloads. */
  snoozedUntil: string | null
  /** Agent-audience only: the team this conversation is assigned to. */
  assignedTeamId: string | null
  /** Why the conversation was ended (from CONVERSATION_END_REASONS), or null when
   *  it was never ended (or ended before this was captured). Shown on both sides
   *  so a closed thread can display its outcome. */
  endReason: ConversationEndReason | null
  /** Agent-only free-text note left when ending the conversation; null otherwise.
   *  Stripped on visitor-facing payloads. */
  endNote: string | null
  /** Conversation labels (agent-managed); empty when untagged. Agent-only. */
  tags: ConversationTagDTO[]
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
/** What Quinn is doing this turn, for the widget's live working trace. */
export type AssistantActivityStatus = 'thinking' | 'searching_kb' | 'reviewing_conversation'

/** Terminal outcome of Quinn's involvement in a conversation (mirrors the db
 *  ASSISTANT_INVOLVEMENT_STATUSES; inlined here so the browser-safe module has
 *  no server import). */
export type AssistantInvolvementOutcome =
  | 'active'
  | 'handed_off'
  | 'resolved_confirmed'
  | 'resolved_assumed'
  | 'abandoned'

/** Short, teammate-facing phrasing for why Quinn handed off (keys mirror the db
 *  ASSISTANT_HANDOFF_REASONS). Single source for the escalation note + the agent
 *  detail panel; callers fall back to the raw key for any unknown reason. */
export const HANDOFF_REASON_LABELS: Record<string, string> = {
  explicit_request: 'customer asked for a person',
  frustration: 'customer seemed frustrated',
  repetition: 'customer repeated the issue',
  low_confidence: "Quinn wasn't confident",
  safety: 'safety topic',
}

/** Quinn's activity on one conversation, for the agent details panel. Null when
 *  Quinn never engaged the conversation. */
export interface ConversationAssistantActivity {
  outcome: AssistantInvolvementOutcome
  /** Structured handoff reason when escalated, else null. */
  handoffReason: string | null
  /** KB sources Quinn cited across the involvement. */
  sources: ConversationMessageCitation[]
  /** CSAT rating attributed to Quinn (1-5), or null. */
  rating: number | null
  /** ISO time of Quinn's last substantive answer, or null. */
  answeredAt: string | null
}

export type ConversationStreamEvent =
  | { kind: 'message'; conversationId: ConversationId; message: ConversationMessageDTO }
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
  | { kind: 'message_deleted'; conversationId: ConversationId; messageId: ConversationMessageId }
  // An existing message changed in an agent-only way (reaction or flag toggled).
  // Carries the enriched AgentConversationMessageDTO and is published on the inbox
  // channel ONLY (publishAgentConversationEvent) — it never reaches the visitor.
  | {
      kind: 'message_updated'
      conversationId: ConversationId
      message: AgentConversationMessageDTO
    }
  // Ephemeral AI-assistant working status while Quinn's turn runs — never
  // persisted. Published on the conversation channel ONLY (not the inbox) so it
  // drives the visitor's live trace without churning the agent inbox list.
  | {
      kind: 'assistant_activity'
      conversationId: ConversationId
      status: AssistantActivityStatus
      at: string
    }
  // Ephemeral streamed answer while Quinn composes. `text` is the FULL clean
  // answer so far (the client REPLACES its placeholder buffer, not appends) so a
  // dropped frame or a retry self-heals. Discarded when the final persisted
  // `message` arrives. Conversation channel only, like `assistant_activity`.
  | {
      kind: 'assistant_delta'
      conversationId: ConversationId
      text: string
      at: string
    }

/** Hard caps shared by client + server validation. */
export const MAX_CONVERSATION_MESSAGE_LENGTH = 4000
export const MAX_CONVERSATION_ATTACHMENTS = 10
