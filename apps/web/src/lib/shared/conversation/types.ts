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
  TranslatedFromMetadata,
  WorkflowBlockPayload,
  BlockReplyMetadata,
} from '@/lib/shared/db-types'
import { CONVERSATION_END_REASONS } from '@/lib/shared/db-types'
import type { JsonValue } from '@/lib/shared/json'
// Type-only: the ticket domain's wire DTO, reused as-is on `ticket_updated` for
// symmetry with `conversation` carrying ConversationDTO (see the design note on
// ConversationStreamEvent below). Erased at build (no runtime import), and the
// `lib/shared -> lib/server` bucket edge already exists (e.g.
// lib/shared/types/posts.ts imports from '@/lib/server/domains/posts` the same
// way) so this adds no new dependency-graph edge to adjudicate.
import type { TicketDTO } from '@/lib/server/domains/tickets'
export type { ConversationStatus, ConversationSystemEvent, ConversationEndReason }
export { CONVERSATION_END_REASONS }
export type ConversationPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'
// 'system' = a status event (e.g. assignment) shown to both sides, rendered as
// a centered notice rather than a message bubble.
export type MessageSenderType = 'visitor' | 'agent' | 'system'
/** A human side of a conversation — who acts (types, reads); 'system' is neither. */
export type ConversationSide = Exclude<MessageSenderType, 'system'>
/** How a conversation arrived — mirrors the conversations.channel column enum. */
export type Channel = 'messenger' | 'email'

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

/** A source the AI assistant grounded a reply in — a KB article, a feedback
 *  post, an admin-curated snippet, or a past-conversation summary. The
 *  message `content` carries inline [n] markers that index into this ordered
 *  list. */
export interface ConversationMessageCitation {
  // Mirrors ASSISTANT_CITATION_TYPES (citation-types.ts); a client-safe copy so
  // this shared type never imports the server domain leaf. 'ticket'/'changelog'
  // are copilot-only (team ceiling); customer-persisted turns only ever carry
  // 'article'/'post'/'changelog'.
  type: 'article' | 'post' | 'snippet' | 'summary' | 'ticket' | 'changelog'
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
  /** The structured block this message renders (Phase C conversational block
   *  layer), so a widget/inbox client can render its interactive affordance
   *  instead of the plain-text fallback in `content`. Null for an ordinary
   *  message. Optional (rather than required like systemEvent) so the many
   *  pre-existing DTO fixtures across the codebase don't all need updating in
   *  this server-only slice; toMessageDTO always sets it explicitly. */
  block?: WorkflowBlockPayload | null
  /** The structured reply this message carries when it answers a block. Null
   *  for an ordinary message (including a degraded free-text reply). Same
   *  optionality rationale as `block`. */
  blockReply?: BlockReplyMetadata | null
}

/**
 * A conversational block's derived interaction state (Phase C, PHASE-C-
 * BLOCK-CONTRACT.md §"Widget state derivation" — see conversation-rows.ts's
 * `computeBlockStates` for the full derivation rules and their doc comment).
 * Lives here (lib/shared, not the components/shared/conversation module that
 * computes it) purely so lib/client code — which `no-restricted-imports`
 * forbids from reaching into `components/` — can still type a block-states
 * map without duplicating the union; `conversation-rows.ts` re-exports this
 * same type for every existing components-side import to keep working
 * unchanged.
 */
export type BlockState = 'pending' | 'chosen' | 'superseded'

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
  /** Agent-only pointer to a Quinn write-tool proposal awaiting approval,
   *  surfaced on the internal note that announced it. Just enough to render the
   *  card and look up the live pending-action row for its current status — the
   *  row, not this pointer, is the source of truth. Optional (unlike
   *  `postSuggestion`) because the realtime `message` event carries the base DTO
   *  without agent enrichment; a live-pushed note picks it up once the thread
   *  next reloads. Never on the base DTO, so it never reaches the visitor. */
  assistantPendingAction?: { pendingActionId: string; toolName: string; summary: string }
  /** Agent-only (P2-D.1 inbox translation): set when this OUTGOING reply was
   *  translated before sending — `content` is the translation actually sent;
   *  this carries the teammate's pre-translation original for "Show original".
   *  Null for every other message (including untranslated agent replies).
   *  Never on the base DTO, so it never reaches the visitor. */
  translatedFrom: TranslatedFromMetadata | null
}

/** Coerce a base/partial message DTO to an agent one, preserving any reaction /
 *  flag fields it already carries (a fresh message has neither yet). Lives here
 *  (lib/shared, not components/conversation/events-reducer.ts, which re-exports
 *  it for its existing callers) so `lib/client/*` query factories — which must
 *  not import from `components/` — can coerce a fetched page's messages before
 *  they ever enter a thread cache. */
export function asAgentMessage(
  m: ConversationMessageDTO | AgentConversationMessageDTO
): AgentConversationMessageDTO {
  return {
    ...m,
    reactions: 'reactions' in m ? m.reactions : [],
    flaggedAt: 'flaggedAt' in m ? m.flaggedAt : null,
    postSuggestion: 'postSuggestion' in m ? m.postSuggestion : null,
    translatedFrom: 'translatedFrom' in m ? (m.translatedFrom ?? null) : null,
  }
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

/**
 * The active SLA on a conversation, projected from the engine's applied
 * snapshot for the inbox chip + breach sort. Agent-only: the DTO builder nulls
 * it on visitor paths and the SSE publish strips it from the visitor copy.
 */
export interface ConversationSlaDTO {
  policyId: string
  policyName: string
  appliedAt: string
  /** Absolute, office-hours-aware first-response deadline; null when the
   *  policy doesn't track first response. */
  firstResponseDueAt: string | null
  /** When the first teammate reply settled the clock, or null while open. */
  firstResponseAt: string | null
  /** Next-response deadline while the customer is waiting on a reply; null
   *  when nobody is waiting or the policy doesn't track it. */
  nextResponseDueAt: string | null
  /** Absolute time-to-close deadline; null when untracked. */
  timeToCloseDueAt: string | null
  /** When the resolution settled the close clock, or null while open. */
  resolvedAt: string | null
  /** Whether this policy pauses its clocks while the conversation is snoozed. */
  pauseOnSnooze: boolean
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
  /** The active SLA's clocks (agent-only); null when no policy is applied.
   *  Stripped on visitor-facing payloads. */
  sla: ConversationSlaDTO | null
  /** Custom attribute values keyed by definition key (values are `{ v, src, at }`
   *  envelopes or bare legacy values — read via readAttributeValue). Agent-only;
   *  empty on visitor-facing payloads. */
  customAttributes: Record<string, JsonValue>
  /** Two-way inbox translation (P2-D.1) activation state; null when not
   *  applicable. Agent-only — stripped (null) on visitor-facing payloads so
   *  the customer widget never sees it (it has no UI for this feature). */
  translation: ConversationTranslationStateDTO | null
}

/**
 * Per-conversation inbox-translation activation state (P2-D.1), projected
 * from the conversation row's translation_enabled / detected_customer_language
 * / translation_dismissed_at columns. Agent-only.
 */
export interface ConversationTranslationStateDTO {
  /** Manual activation toggle — when true, incoming messages render
   *  translated and outgoing replies are translated before sending. */
  enabled: boolean
  /** Best-effort, once-detected primary language of the customer's messages
   *  (a bare BCP-47 primary subtag, e.g. "fr"), or null before detection has
   *  run (or found nothing to detect from). */
  detectedCustomerLanguage: string | null
  /** True once a teammate has dismissed the auto-suggest banner for this
   *  conversation, so it stays dismissed rather than reappearing every load. */
  suggestionDismissed: boolean
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
  capability_limit: 'outside what Quinn can do',
  safety: 'safety topic',
  system_error: 'Quinn hit an error',
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

/**
 * Ticket-thread realtime events (unified inbox §3.2, M3). Design choice:
 * PARALLEL kinds (`ticket_message` / `ticket_updated` / `ticket_read`) rather
 * than folding tickets into the existing `message` / `conversation` / `read`
 * kinds under a shared itemRef. The existing conversation-side reducers
 * (applyAgentThreadEvent, applyVisitorThreadEvent, agentEventChangesInboxList)
 * all switch on `kind` and read `evt.conversationId` straight off the event —
 * reshaping those kinds to carry an itemRef union would force every one of
 * those switches to add a branch, touching code this task must not rewrite.
 * Parallel kinds instead fall through those switches' existing `default` case
 * untouched, and get their own small single-purpose reducers
 * (applyTicketThreadEvent, events-reducer.ts). There is no `ticket_message_updated`
 * (no reactions/flags on ticket messages) or `ticket_message_deleted` (no
 * delete-ticket-message feature exists yet) — add them alongside their
 * conversation counterparts if/when tickets grow those features.
 *
 * `ticket: TicketDTO` on `ticket_updated` mirrors `conversation: ConversationDTO`
 * on `conversation`: one push refreshes both the list row and an open detail
 * panel. `ticket_read`'s `side` reuses MessageSenderType exactly like `read`
 * does — 'agent' == the assignee's watermark, 'visitor' == the requester's,
 * mirroring how ticket-message senderType already overloads the same two
 * values (see ticket-unread.service.ts).
 */
export type TicketStreamEvent =
  | { kind: 'ticket_message'; ticketId: TicketId; message: ConversationMessageDTO }
  | { kind: 'ticket_updated'; ticket: TicketDTO }
  | { kind: 'ticket_read'; ticketId: TicketId; side: MessageSenderType; at: string }

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
  | TicketStreamEvent

/** Hard caps shared by client + server validation. */
export const MAX_CONVERSATION_MESSAGE_LENGTH = 4000
export const MAX_CONVERSATION_ATTACHMENTS = 10
