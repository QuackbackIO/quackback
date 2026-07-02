import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type { StatusId } from '@quackback/ids'
import type { boards, roadmaps, tags } from './schema/boards'
import type { postStatuses } from './schema/statuses'
import type {
  posts,
  postRoadmaps,
  votes,
  comments,
  commentReactions,
  postNotes,
} from './schema/posts'
import type { integrations } from './schema/integrations'
import type {
  changelogCategories,
  changelogEntries,
  changelogEntryPosts,
  changelogProducts,
} from './schema/changelog'
import type {
  conversations,
  chatMessages,
  chatTags,
  chatMessageMentions,
  chatMessageReactions,
  chatMessageFlags,
} from './schema/chat'
import type { principal } from './schema/auth'
import type { teams, teamMemberships } from './schema/teams'
import type { roles, permissions, rolePermissions, principalRoleAssignments } from './schema/roles'
import type { auditEvents } from './schema/audit-events'
import type { organizations, contacts, contactUserLinks } from './schema/organizations'
import type { ticketStatuses } from './schema/ticket-statuses'
import type {
  tickets,
  ticketThreads,
  ticketAttachments,
  ticketParticipants,
  ticketShares,
  ticketActivity,
} from './schema/tickets'
import type { inboxes, inboxChannels, inboxMemberships } from './schema/inboxes'
import type { routingRules } from './schema/routing-rules'
import type {
  businessHours,
  slaPolicies,
  slaTargets,
  ticketSlaClocks,
  escalationRules,
  slaEscalationLog,
} from './schema/sla'
import type { ticketSubscriptions } from './schema/ticket-subscriptions'
import type { webhookDeliveries } from './schema/webhook-deliveries'
import type { widgetApplications, widgetEnvironmentProfiles } from './schema/widget-profiles'

// Status categories (defined here to avoid circular imports in tests)
export const STATUS_CATEGORIES = ['active', 'complete', 'closed'] as const
export type StatusCategory = (typeof STATUS_CATEGORIES)[number]

// Moderation states for posts - single source of truth, kept in sync with
// the posts.moderation_state column enum (schema.test.ts pins the match).
export const MODERATION_STATES = [
  'published',
  'pending',
  'spam',
  'archived',
  'closed',
  'deleted',
] as const
export type ModerationState = (typeof MODERATION_STATES)[number]

// Board types
export type Board = InferSelectModel<typeof boards>
export type NewBoard = InferInsertModel<typeof boards>

// Board settings (stored in boards.settings JSONB column)
export interface BoardSettings {
  roadmapStatusIds?: StatusId[] // Status IDs to show on roadmap
}

// ----------------------------------------------------------------------
// Per-action access tiers (View+Vote / Comment / Submit) and per-board
// approval overrides. The legacy `BoardAudience` discriminated union was
// removed in migration 0080 - every reader now consults `BoardAccess`.
// ----------------------------------------------------------------------

export const ACCESS_TIERS = ['anonymous', 'authenticated', 'segments', 'team'] as const
export type AccessTier = (typeof ACCESS_TIERS)[number]

/** Restriction rank - higher number is stricter. Used for tier-invariant
 *  checks: a derived action (comment / submit) cannot be more permissive
 *  than view. */
export const ACCESS_TIER_RANK: Record<AccessTier, number> = {
  anonymous: 0,
  authenticated: 1,
  segments: 2,
  team: 3,
}

/** Per-board moderation rule values. A board can either:
 *   - `inherit`: resolve from the workspace's portalConfig.moderationDefault.requireApproval
 *   - `on`:      force-hold matching submissions for review (override on)
 *   - `off`:     force-allow matching submissions without review (override off)
 *  The three axes (anonPosts / signedPosts / comments) match the design's
 *  Moderation tab and the workspace requireApproval shape. */
export const MODERATION_RULE_VALUES = ['inherit', 'on', 'off'] as const
export type ModerationRuleValue = (typeof MODERATION_RULE_VALUES)[number]

export interface BoardAccess {
  view: AccessTier
  vote: AccessTier
  comment: AccessTier
  submit: AccessTier
  /** Per-action segment allowlists - used wherever the matching tier is
   *  'segments'. A board can say "Active Users can view & comment, but
   *  only Beta testers can submit." Invalid (and rejected on save) when
   *  an action's tier is 'segments' but that action's list is empty. */
  segments: {
    view: string[]
    vote: string[]
    comment: string[]
    submit: string[]
  }
  /** Tri-state per-board moderation overrides for posts (split by author
   *  type) and comments. `inherit` defers to the workspace default; `on`
   *  and `off` are explicit per-board overrides. */
  moderation: {
    anonPosts: ModerationRuleValue
    signedPosts: ModerationRuleValue
    comments: ModerationRuleValue
  }
}

export const DEFAULT_BOARD_ACCESS: BoardAccess = {
  view: 'anonymous',
  vote: 'anonymous',
  comment: 'anonymous',
  submit: 'anonymous',
  segments: { view: [], vote: [], comment: [], submit: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
}

// Integration config (stored in integrations.config JSONB column)
// Each integration defines its own typed config at the integration layer.
export type IntegrationConfig = Record<string, unknown>

// Event mapping config (stored in event_mappings JSONB columns)
export interface EventMappingActionConfig {
  templateId?: string
  message?: string
  [key: string]: string | boolean | number | undefined
}

export interface EventMappingFilters {
  boardIds?: string[]
  statusIds?: string[]
  [key: string]: string[] | string | boolean | number | undefined
}

// TipTap rich text content (stored in contentJson JSONB columns)
export interface TiptapContent {
  type: string
  content?: TiptapContent[]
  text?: string
  marks?: { type: string; attrs?: Record<string, string | number | boolean | null> }[]
  attrs?: Record<string, string | number | boolean | null>
}

// Raw feedback JSONB column types
export interface RawFeedbackAuthor {
  name?: string
  email?: string
  externalUserId?: string
  principalId?: string
  attributes?: Record<string, unknown>
}

export interface RawFeedbackContent {
  subject?: string
  text: string
  html?: string
  language?: string
}

export interface RawFeedbackThreadMessage {
  id: string
  authorName?: string
  authorEmail?: string
  role?: 'customer' | 'agent' | 'teammate' | 'system'
  sentAt: string
  text: string
  isTrigger?: boolean
}

export interface RawFeedbackItemContextEnvelope {
  sourceChannel?: {
    id?: string
    name?: string
    type?: string
    purpose?: string
    permalink?: string
  }
  sourceTicket?: {
    id?: string
    status?: string
    priority?: string
    tags?: string[]
    customFields?: Record<string, unknown>
  }
  sourceConversation?: {
    id?: string
    state?: string
    tags?: string[]
  }
  thread?: RawFeedbackThreadMessage[]
  customer?: {
    id?: string
    email?: string
    company?: string
    plan?: string
    mrr?: number
    attributes?: Record<string, unknown>
  }
  pageContext?: {
    url?: string
    title?: string
    route?: string
    userAgent?: string
    sessionId?: string
  }
  attachments?: Array<{
    id?: string
    name: string
    mimeType?: string
    sizeBytes?: number
    url?: string
  }>
  metadata?: Record<string, unknown>
}

// Use case types for personalized onboarding
export const USE_CASE_TYPES = ['saas', 'consumer', 'marketplace', 'internal'] as const
export type UseCaseType = (typeof USE_CASE_TYPES)[number]

// Setup state for tracking onboarding/provisioning (stored in settings.setup_state)
export interface SetupState {
  version: number // Schema version for future migrations
  steps: {
    core: boolean // Core schema setup complete (settings created)
    workspace: boolean // Workspace name/slug configured
    boards: boolean // At least one board created or explicitly skipped
  }
  completedAt?: string // ISO timestamp when onboarding was fully completed
  source: 'cloud' | 'self-hosted' // How this instance was provisioned
  useCase?: UseCaseType // Product type for personalized board recommendations
}

// Default setup state for new instances (self-hosted starts with workspace incomplete)
export const DEFAULT_SETUP_STATE: SetupState = {
  version: 1,
  steps: {
    core: true,
    workspace: false,
    boards: false,
  },
  source: 'self-hosted',
}

// Helper to parse setup state from settings
export function getSetupState(setupStateJson: string | null): SetupState | null {
  if (!setupStateJson) return null
  try {
    const parsed = JSON.parse(setupStateJson) as SetupState
    return { ...parsed, source: parsed.source ?? 'self-hosted' }
  } catch {
    return null
  }
}

// Helper to check if onboarding is complete
export function isOnboardingComplete(setupState: SetupState | null): boolean {
  if (!setupState) return false
  return setupState.steps.core && setupState.steps.workspace && setupState.steps.boards
}

// Helper to get typed board settings
export function getBoardSettings(board: Board): BoardSettings {
  const settings = (board.settings || {}) as BoardSettings
  return {
    roadmapStatusIds: settings.roadmapStatusIds,
  }
}

// Roadmap types (filtered views of posts within a board)
export type Roadmap = InferSelectModel<typeof roadmaps>
export type NewRoadmap = InferInsertModel<typeof roadmaps>

// Tag types
export type Tag = InferSelectModel<typeof tags>
export type NewTag = InferInsertModel<typeof tags>

// Post status types (customizable statuses)
export type PostStatusEntity = InferSelectModel<typeof postStatuses>
export type NewPostStatusEntity = InferInsertModel<typeof postStatuses>

// Post types
export type Post = InferSelectModel<typeof posts>
export type NewPost = InferInsertModel<typeof posts>

// Post roadmap types (many-to-many junction)
export type PostRoadmap = InferSelectModel<typeof postRoadmaps>
export type NewPostRoadmap = InferInsertModel<typeof postRoadmaps>

// Vote types
export type Vote = InferSelectModel<typeof votes>
export type NewVote = InferInsertModel<typeof votes>

// Comment types
export type Comment = InferSelectModel<typeof comments>
export type NewComment = InferInsertModel<typeof comments>

// Post note types (internal staff notes)
export type PostNote = InferSelectModel<typeof postNotes>
export type NewPostNote = InferInsertModel<typeof postNotes>

// Comment reaction types
export type CommentReaction = InferSelectModel<typeof commentReactions>
export type NewCommentReaction = InferInsertModel<typeof commentReactions>

// Support-inbox conversation statuses - kept in sync with the conversations.status
// column enum (schema.test.ts pins the match).
export const CONVERSATION_STATUSES = ['open', 'pending', 'closed'] as const
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

// Why a conversation was ended (conversations.end_reason). A plain-text column
// whose allowed values live here as the single source of truth for validation
// + the end-conversation UI. Resolution-rate (for later analytics) =
// count(end_reason IN ('resolved','tracked_as_feedback')) / count(all ended
// EXCLUDING 'spam').
export const CONVERSATION_END_REASONS = [
  'resolved',
  'tracked_as_feedback',
  'duplicate',
  'no_response',
  'spam',
  'other',
] as const
export type ConversationEndReason = (typeof CONVERSATION_END_REASONS)[number]

// Per-agent manual availability (principal.chat_availability). 'online' = route
// chats to me when connected; 'away' = connected but opted out of routing.
export const AGENT_AVAILABILITY_VALUES = ['online', 'away'] as const
export type AgentAvailability = (typeof AGENT_AVAILABILITY_VALUES)[number]

// The inbound channel a conversation arrived on - kept in sync with the
// conversations.channel column enum. Existing live-chat threads default to
// 'messenger'; 'email' and 'web_form' are wired up in later phases. This turns
// "live chat vs ticket" into one polymorphic conversation with a channel field.
export const CHANNELS = ['messenger', 'email', 'web_form'] as const
export type Channel = (typeof CHANNELS)[number]

// Agent-set conversation priority for inbox triage - kept in sync with the
// conversations.priority column enum. 'none' = unset (the default).
export const CONVERSATION_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
export type ConversationPriority = (typeof CONVERSATION_PRIORITIES)[number]

// Which side of a conversation a message came from - kept in sync with the
// chat_messages.sender_type column enum. 'system' rows are status events (e.g.
// assignment) shown to both sides; attributed to the relevant agent's principal
// and never counted as unread.
export const CHAT_SENDER_TYPES = ['visitor', 'agent', 'system'] as const
export type ChatSenderType = (typeof CHAT_SENDER_TYPES)[number]

// A single attachment ref stored on a chat message (chat_messages.attachments).
export interface ChatAttachment {
  url: string
  name: string
  contentType: string
  size: number
}

// Channel provenance stored on a chat message (chat_messages.metadata). Null for
// ordinary in-app live-chat messages; set when a message arrives over another
// channel so the inbox can render it and dedupe provider retries.
/** Author-less 'system' status events (chat ended/reopened, assignment). */
export type ChatSystemEventKind = 'chat_ended' | 'chat_reopened' | 'assigned'

export interface ChatSystemEvent {
  kind: ChatSystemEventKind
  /** Assignee display name for 'assigned'. */
  agentName?: string
}

// An agent-only suggestion (carried on an internal note) to track a resolved
// conversation as a feedback post. Surfaced exclusively via the agent DTO - it
// never reaches the visitor.
export interface PostSuggestion {
  boardId: string
  title: string
  content: string
}

export interface ChatMessageMetadata {
  /** The channel this message arrived through, when not in-app live chat. */
  source?: 'email'
  /** Provider Message-ID for an inbound email, used to dedupe webhook retries. */
  emailMessageId?: string
  /** For 'system' messages: the structured event, so clients can localize the
   *  notice instead of rendering the stored (English) content. */
  systemEvent?: ChatSystemEvent
  /** Agent-only suggestion (on an internal note) to track this conversation as a
   *  feedback post. Surfaced only via the agent DTO, never to the visitor. */
  postSuggestion?: PostSuggestion
}

// Support-inbox conversation row types
export type Conversation = InferSelectModel<typeof conversations>
export type NewConversation = InferInsertModel<typeof conversations>
export type ChatMessage = InferSelectModel<typeof chatMessages>
export type NewChatMessage = InferInsertModel<typeof chatMessages>
export type ChatTag = InferSelectModel<typeof chatTags>
export type NewChatTag = InferInsertModel<typeof chatTags>
export type ChatMessageMention = InferSelectModel<typeof chatMessageMentions>
export type NewChatMessageMention = InferInsertModel<typeof chatMessageMentions>
export type ChatMessageReaction = InferSelectModel<typeof chatMessageReactions>
export type NewChatMessageReaction = InferInsertModel<typeof chatMessageReactions>
export type ChatMessageFlag = InferSelectModel<typeof chatMessageFlags>
export type NewChatMessageFlag = InferInsertModel<typeof chatMessageFlags>

// Reaction emoji constants (client-safe)
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '👀'] as const
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

// Integration types
export type Integration = InferSelectModel<typeof integrations>
export type NewIntegration = InferInsertModel<typeof integrations>
export type IntegrationStatus = Integration['status']

// Changelog types
export type ChangelogEntry = InferSelectModel<typeof changelogEntries>
export type NewChangelogEntry = InferInsertModel<typeof changelogEntries>
export type ChangelogEntryPost = InferSelectModel<typeof changelogEntryPosts>
export type NewChangelogEntryPost = InferInsertModel<typeof changelogEntryPosts>
export type ChangelogCategory = InferSelectModel<typeof changelogCategories>
export type NewChangelogCategory = InferInsertModel<typeof changelogCategories>
export type ChangelogProduct = InferSelectModel<typeof changelogProducts>
export type NewChangelogProduct = InferInsertModel<typeof changelogProducts>

// Principal types
export type Principal = InferSelectModel<typeof principal>
export type NewPrincipal = InferInsertModel<typeof principal>

// Ticketing — Phase 1
export type Team = InferSelectModel<typeof teams>
export type NewTeam = InferInsertModel<typeof teams>
export type TeamMembership = InferSelectModel<typeof teamMemberships>
export type NewTeamMembership = InferInsertModel<typeof teamMemberships>
export type RoleRecord = InferSelectModel<typeof roles>
export type NewRoleRecord = InferInsertModel<typeof roles>
export type PermissionRecord = InferSelectModel<typeof permissions>
export type NewPermissionRecord = InferInsertModel<typeof permissions>
export type RolePermission = InferSelectModel<typeof rolePermissions>
export type NewRolePermission = InferInsertModel<typeof rolePermissions>
export type PrincipalRoleAssignment = InferSelectModel<typeof principalRoleAssignments>
export type NewPrincipalRoleAssignment = InferInsertModel<typeof principalRoleAssignments>
export type AuditEvent = InferSelectModel<typeof auditEvents>
export type NewAuditEvent = InferInsertModel<typeof auditEvents>

// Ticketing — Phase 2 (organizations & contacts)
export type Organization = InferSelectModel<typeof organizations>
export type NewOrganization = InferInsertModel<typeof organizations>
export type Contact = InferSelectModel<typeof contacts>
export type NewContact = InferInsertModel<typeof contacts>
export type ContactUserLink = InferSelectModel<typeof contactUserLinks>
export type NewContactUserLink = InferInsertModel<typeof contactUserLinks>

// Ticketing — Phase 3 (ticket core)
export type TicketStatusEntity = InferSelectModel<typeof ticketStatuses>
export type NewTicketStatusEntity = InferInsertModel<typeof ticketStatuses>
export type Ticket = InferSelectModel<typeof tickets>
export type NewTicket = InferInsertModel<typeof tickets>
export type TicketThread = InferSelectModel<typeof ticketThreads>
export type NewTicketThread = InferInsertModel<typeof ticketThreads>
export type TicketAttachment = InferSelectModel<typeof ticketAttachments>
export type NewTicketAttachment = InferInsertModel<typeof ticketAttachments>
export type TicketParticipant = InferSelectModel<typeof ticketParticipants>
export type NewTicketParticipant = InferInsertModel<typeof ticketParticipants>
export type TicketShare = InferSelectModel<typeof ticketShares>
export type NewTicketShare = InferInsertModel<typeof ticketShares>
export type TicketActivity = InferSelectModel<typeof ticketActivity>
export type NewTicketActivity = InferInsertModel<typeof ticketActivity>

// Ticketing — Phase 4 (inboxes, channels, routing)
export type Inbox = InferSelectModel<typeof inboxes>
export type NewInbox = InferInsertModel<typeof inboxes>
export type InboxChannel = InferSelectModel<typeof inboxChannels>
export type NewInboxChannel = InferInsertModel<typeof inboxChannels>
export type InboxMembership = InferSelectModel<typeof inboxMemberships>
export type NewInboxMembership = InferInsertModel<typeof inboxMemberships>
export type RoutingRule = InferSelectModel<typeof routingRules>
export type NewRoutingRule = InferInsertModel<typeof routingRules>

// Ticketing — Phase 5 (SLA + escalations)
export type BusinessHours = InferSelectModel<typeof businessHours>
export type NewBusinessHours = InferInsertModel<typeof businessHours>
export type SlaPolicy = InferSelectModel<typeof slaPolicies>
export type NewSlaPolicy = InferInsertModel<typeof slaPolicies>
export type SlaTarget = InferSelectModel<typeof slaTargets>
export type NewSlaTarget = InferInsertModel<typeof slaTargets>
export type TicketSlaClock = InferSelectModel<typeof ticketSlaClocks>
export type NewTicketSlaClock = InferInsertModel<typeof ticketSlaClocks>
export type EscalationRule = InferSelectModel<typeof escalationRules>
export type NewEscalationRule = InferInsertModel<typeof escalationRules>
export type SlaEscalationLogEntry = InferSelectModel<typeof slaEscalationLog>
export type NewSlaEscalationLogEntry = InferInsertModel<typeof slaEscalationLog>

export type TicketSubscription = InferSelectModel<typeof ticketSubscriptions>
export type NewTicketSubscription = InferInsertModel<typeof ticketSubscriptions>

export type WebhookDelivery = InferSelectModel<typeof webhookDeliveries>
export type NewWebhookDelivery = InferInsertModel<typeof webhookDeliveries>

// Widget applications and environment profiles
export type WidgetApplication = InferSelectModel<typeof widgetApplications>
export type NewWidgetApplication = InferInsertModel<typeof widgetApplications>
export type WidgetEnvironmentProfile = InferSelectModel<typeof widgetEnvironmentProfiles>
export type NewWidgetEnvironmentProfile = InferInsertModel<typeof widgetEnvironmentProfiles>

// Re-export SLA literal-union types & business-hours interfaces from the schema.
export type {
  SlaTargetKind,
  SlaClockState,
  SlaPolicyScope,
  EscalationRecipientType,
  EscalationChannel,
  BusinessHoursRange,
  BusinessHoursWeek,
  BusinessHoursHoliday,
} from './schema/sla'
// Re-export ticket-related literal-union types used by the SLA domain.
export type {
  TicketPriority,
  TicketChannel,
  TicketVisibilityScope,
  TicketThreadAudience,
  TicketParticipantRole,
  TicketShareLevel,
} from './schema/tickets'
export type { TicketStatusCategory } from './schema/ticket-statuses'
export type { AuditDiff, AuditJsonValue } from './schema/audit-events'

// Extended types for queries with relations
export type CommentWithReplies = Comment & {
  replies: CommentWithReplies[]
  reactions: CommentReaction[]
}

export type PostWithDetails = Post & {
  board: Board
  tags: Tag[]
  roadmaps: Roadmap[]
  comments: CommentWithReplies[]
  votes: Vote[]
}

// Inbox query types
export type PostListItem = Post & {
  board: Pick<Board, 'id' | 'name' | 'slug'>
  tags: Pick<Tag, 'id' | 'name' | 'color'>[]
  commentCount: number
  authorName: string | null
}

export interface InboxPostListResult {
  items: PostListItem[]
  nextCursor: string | null
  hasMore: boolean
}
