/**
 * Input + DTO shapes for the ticket domain (support platform §4.2). The DTO
 * types are the contract the admin ticket UI codes against; they carry only
 * plain JSON (ISO strings, resolved display names) so a client can import them
 * type-only with no server dependency.
 */
import type {
  TicketId,
  TicketStatusId,
  PrincipalId,
  TeamId,
  CompanyId,
  ConversationId,
} from '@quackback/ids'
import type {
  TicketType,
  TicketStage,
  TicketStatusCategory,
  ConversationPriority,
  TiptapContent,
  ConversationAttachment,
} from '@/lib/shared/db-types'
import type { ConversationAuthorDTO } from '@/lib/shared/conversation/types'
import type { JsonValue } from '@/lib/shared/json'

// ---------------------------------------------------------------------------
// Service inputs
// ---------------------------------------------------------------------------

/** Fields accepted when opening a ticket. Status + number are resolved server-side. */
export interface CreateTicketInput {
  type: TicketType
  title: string
  /** Optional opening message that seeds the ticket thread (the basic-form
   *  "description"). Authored by the requester when they file it themselves,
   *  otherwise by the creating teammate. */
  description?: string
  /** The rich-doc counterpart of `description`, sanitized + validated through
   *  the same path as a reply/note (see `insertTicketMessage`). When present,
   *  `description` is only the fallback plaintext — the derived `content`
   *  mirror comes from this doc when the raw description is blank. */
  descriptionJson?: TiptapContent | null
  /** Attachments on the opening message, same shape/limits as a reply. */
  attachments?: ConversationAttachment[]
  requesterPrincipalId?: PrincipalId | null
  /** Explicit assignee. Always wins over the agent-create defaults (the source
   *  conversation's assignee, else the creating agent — see `createTicket`). */
  assigneePrincipalId?: PrincipalId | null
  priority?: ConversationPriority
  companyId?: CompanyId | null
  /** Set by the create-from-a-conversation flow (unified inbox §M5): the
   *  conversation the ticket is being opened from. Used by the agent-create
   *  defaults to inherit the conversation's assignee; the link row itself is
   *  still written by the separate link step (`linkTicketToConversation`). */
  sourceConversationId?: ConversationId | null
  customAttributes?: Record<string, unknown>
  /** CONVERGENCE PHASE 1b opt-in, set ONLY by the four customer-intake paths
   *  (portal `createMyTicket`, the widget fn, API v1, MCP `create_ticket`):
   *  on a CUSTOMER ticket with a requester, `createTicketCore` creates the
   *  pair's backing conversation + the `ticket_conversations` link in the same
   *  transaction (see createTicketCore's doc for the contract). Deliberately
   *  NOT derived from (type, requester) alone: agent-shaped flows that create
   *  a customer ticket WITH a requester — the admin create dialog, the
   *  create-from-a-conversation flow, `convert_to_ticket`, Quinn's own
   *  create_ticket tool — leave this unset and stay standalone/explicitly
   *  linked exactly as before. */
  withBackingConversation?: boolean
}

/** Polymorphic, independent assignment: an absent key leaves that side as-is. */
export interface AssignTicketInput {
  assigneePrincipalId?: PrincipalId | null
  assigneeTeamId?: TeamId | null
}

/** How a ticket list is ordered. `recent`/`oldest` sort by activity (updatedAt). */
export type TicketSort = 'recent' | 'oldest' | 'created' | 'priority'

/** Who a list is scoped to by assignee: the caller, nobody, or a specific teammate. */
export type TicketAssigneeFilter = 'me' | 'unassigned' | PrincipalId

/** List query filters. All optional; omitted filters do not constrain the result. */
export interface TicketListFilter {
  type?: TicketType
  statusCategory?: TicketStatusCategory
  stage?: TicketStage
  priority?: ConversationPriority
  assignee?: TicketAssigneeFilter
  teamId?: TeamId
  requesterPrincipalId?: PrincipalId
  companyId?: CompanyId
  /** Free-text match over the ticket title + its messages' `search_vector`
   *  (same FTS primitive as `searchTickets`). A bare/`#`-prefixed integer
   *  (e.g. "42", "#42") also matches by ticket number, OR'd with the FTS match. */
  search?: string
  sort?: TicketSort
  /** Keyset cursor: the previous page's last ticket id, re-resolved server-side
   *  against the active sort (mirrors the conversation inbox). */
  cursor?: TicketId
  limit?: number
  /**
   * Unified inbox one-row rule, restated as the CONVERGENCE rule
   * (scratchpad/convergence-design.md Phase 2 — alias semantics): a
   * `type: 'customer'` ticket with an active `ticket_conversations` link IS
   * its conversation — the pair lists/counts/routes as the conversation row
   * everywhere in the agent inbox, never as a second ticket row. Back-office
   * and tracker tickets are never excluded by this flag (they have no
   * conversation-row analogue — their links are context, not a shared
   * thread), even if a link row exists for them.
   */
  excludeConversationLinked?: boolean
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/**
 * A resolved principal reference (requester / assignee). Structurally the inbox
 * author, so it aliases ConversationAuthorDTO — the DTO builder reuses the inbox
 * loader (loadAuthors), which produces exactly this shape.
 */
export type TicketPrincipalRef = ConversationAuthorDTO

/** The ticket's status, flattened for display. */
export interface TicketStatusRef {
  id: TicketStatusId
  name: string
  color: string
  category: TicketStatusCategory
}

/**
 * The requester-facing stage the status projects to. `slot` is null and `label`
 * is null when the status is hidden from the requester (internal-only).
 */
export interface TicketStageRef {
  slot: TicketStage | null
  label: string | null
}

/** Polymorphic assignee: a teammate, a team, both, or neither. */
export interface TicketAssigneeRef {
  principalId: PrincipalId | null
  displayName: string | null
  teamId: TeamId | null
  teamName: string | null
}

/** The B2B company context shown inline on a ticket. */
export interface TicketCompanyRef {
  id: CompanyId
  name: string
}

/**
 * The ticket's active SLA (support platform §4.6's ticket-anchored TTR clock),
 * projected from the `tickets.sla_applied` stamp — null when no SLA is
 * applied. Only the display fields the inbox chip needs are carried; the full
 * stamp (markers, pause bookkeeping) stays server-side.
 */
export interface TicketSlaRef {
  /** Snapshot of the policy name (a later policy edit/delete never rewrites it). */
  policyName: string
  /** Absolute, office-hours-aware TTR deadline (ISO). */
  timeToResolveDueAt: string
  /** When the ticket first reached a closed-category status (ISO), or null
   *  while the clock is open. Never re-cleared — first resolution settles
   *  TTR permanently (see ticket-sla.service.ts). */
  resolvedAt: string | null
  /** Whether the clock is paused for display: the ticket sits in a
   *  'pending'-category status under a pauseOnPending policy. Status-derived
   *  (mirrors slaChipState's snoozed && pauseOnSnooze rule) rather than read
   *  off the stamp's pausedAt, so the chip can't disagree with the status
   *  pill it's rendered next to. */
  paused: boolean
}

/** The wire shape for a ticket. `number` is the raw sequence; `reference` is it rendered. */
export interface TicketDTO {
  id: TicketId
  number: number
  reference: string
  type: TicketType
  title: string
  status: TicketStatusRef
  stage: TicketStageRef
  priority: ConversationPriority
  requester: TicketPrincipalRef | null
  assignee: TicketAssigneeRef
  company: TicketCompanyRef | null
  firstResponseAt: string | null
  dueAt: string | null
  resolvedAt: string | null
  /** The active ticket SLA (TTR clock), or null when none is applied. */
  sla: TicketSlaRef | null
  createdAt: string
  updatedAt: string
  reopenedCount: number
  /** Custom attribute values keyed by definition key (values are `{ v, src, at }`
   *  envelopes or bare legacy values — read via readAttributeValue). The
   *  registry is shared with conversations (unified inbox §3.5). */
  customAttributes: Record<string, JsonValue>
  /** The latest customer-visible message's preview text (same truncation as the
   *  conversation inbox's `lastMessagePreview`), falling back to the ticket
   *  title when only internal notes exist or the thread is empty. */
  lastMessagePreview: string | null
  /** The newest non-deleted message's timestamp, of ANY kind — an internal note
   *  still counts as activity, unlike `lastMessagePreview`. Null when the
   *  thread is empty (e.g. a ticket opened with no description). */
  lastMessageAt: string | null
}

/**
 * The requester-audience twin of `TicketDTO` (portal/widget requester fns):
 * everything the agent DTO carries EXCEPT the two internal-only fields.
 * `status` (internal name/category — a null-`publicStage` status must never
 * leak, per the ticket_statuses contract) and `sla` (policy name + resolve
 * deadline — internal commitments, stripped from conversation visitor DTOs
 * for the same reason, see conversation.query.ts's `side` split) are nulled.
 * The requester-facing projection remains `stage`.
 *
 * `unreadCount` is the requester-side unread badge (agent-authored messages
 * newer than the pair's shared watermark). CONVERGENCE PHASE 2: a linked
 * pair's count reads the CONVERSATION's `visitorLastReadAt` (one shared
 * watermark — Messages and Tickets dual-list with read-through); an unlinked
 * standalone ticket's reads the legacy `requesterLastReadAt`. Set by the
 * list/detail reads (`requesterTicketUnreadMap`); `toRequesterTicketDTO`
 * defaults it to 0 for the create path (a just-filed ticket has nothing
 * unread).
 */
export type RequesterTicketDTO = Omit<TicketDTO, 'status' | 'sla'> & {
  status: null
  sla: null
  unreadCount: number
}

/** A page of `listTickets`: the rows plus whether an older page follows. */
export interface TicketListPage {
  tickets: TicketDTO[]
  hasMore: boolean
}

// ---------------------------------------------------------------------------
// Bulk mutation (support platform §4.6, ticket axis)
// ---------------------------------------------------------------------------

/** One inbox bulk action for tickets, discriminated on `type`. Each variant
 *  maps 1:1 onto the single-ticket service op its non-bulk fn calls, mirroring
 *  the conversation domain's bulk action shape. */
export type BulkTicketAction =
  | { type: 'assign'; assignTo: PrincipalId | null }
  | { type: 'assign_team'; teamId: TeamId | null }
  | { type: 'priority'; priority: ConversationPriority }
  | { type: 'set_status'; statusId: TicketStatusId }

/** The result of `bulkUpdateTickets`: which tickets updated, and why any
 *  didn't — mirrors the conversation bulk fn's succeeded/failed shape. */
export interface BulkTicketResult {
  succeeded: TicketId[]
  failed: { id: TicketId; reason: string }[]
}
