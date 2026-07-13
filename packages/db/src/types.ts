import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type { PostStatusId } from '@quackback/ids'
import type { boards, roadmaps, postTags } from './schema/boards'
import type { postStatuses } from './schema/statuses'
import type {
  posts,
  postRoadmaps,
  postTagAssignments,
  postVotes,
  postComments,
  postCommentReactions,
  postNotes,
} from './schema/posts'
import type { integrations } from './schema/integrations'
import type { changelogEntries, changelogEntryPosts } from './schema/changelog'
import type {
  conversations,
  conversationMessages,
  conversationTags,
  conversationMessageMentions,
  conversationMessageReactions,
  conversationMessageFlags,
  conversationMessageTranslations,
} from './schema/conversation'
import type { teams, teamMembers } from './schema/teams'
import type { tickets, ticketStatuses, ticketConversations, ticketLinks } from './schema/tickets'
import type { ticketActivity } from './schema/ticket-activity'
import type { principal } from './schema/auth'

// Status categories (defined here to avoid circular imports in tests)
export const STATUS_CATEGORIES = ['active', 'complete', 'closed'] as const
export type StatusCategory = (typeof STATUS_CATEGORIES)[number]

// Moderation states for posts — single source of truth, kept in sync with
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
  roadmapStatusIds?: PostStatusId[] // Status IDs to show on roadmap
}

// ----------------------------------------------------------------------
// Per-action access tiers (View+Vote / Comment / Submit) and per-board
// approval overrides. The legacy `BoardAudience` discriminated union was
// removed in migration 0080 — every reader now consults `BoardAccess`.
// ----------------------------------------------------------------------

export const ACCESS_TIERS = ['anonymous', 'authenticated', 'segments', 'team'] as const
export type AccessTier = (typeof ACCESS_TIERS)[number]

/** Restriction rank — higher number is stricter. Used for tier-invariant
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
  /** Per-action segment allowlists — used wherever the matching tier is
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

// Key order is jsonb-canonical (length, then bytewise) so the serialized
// column default matches what postgres stores for the migration's default;
// the drift check compares the two strings byte for byte.
export const DEFAULT_BOARD_ACCESS: BoardAccess = {
  view: 'anonymous',
  vote: 'anonymous',
  submit: 'anonymous',
  comment: 'anonymous',
  segments: { view: [], vote: [], submit: [], comment: [] },
  moderation: { comments: 'inherit', anonPosts: 'inherit', signedPosts: 'inherit' },
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
/**
 * First-run intent — ideally an *outcome* ICP would name (Featurebase /
 * Intercom / Statuspage style), not an industry vertical.
 *
 * UI offers: product_feedback | customer_support | help_center | internal.
 * Legacy saas | consumer | marketplace still parse (config-file / old rows)
 * and collapse onto an outcome via normalizeOnboardingOutcome (apps/web
 * shared db-types).
 */
export const USE_CASE_TYPES = [
  'product_feedback',
  'customer_support',
  'help_center',
  'internal',
  // Legacy — do not show in the picker
  'saas',
  'consumer',
  'marketplace',
] as const
export type UseCaseType = (typeof USE_CASE_TYPES)[number]

/** Outcomes shown in the onboarding picker (stable subset of UseCaseType). */
export const ONBOARDING_OUTCOMES = [
  'product_feedback',
  'customer_support',
  'help_center',
  'internal',
] as const
export type OnboardingOutcome = (typeof ONBOARDING_OUTCOMES)[number]

// Setup state for tracking onboarding/provisioning (stored in settings.setup_state).
// V2 deliberately separates completing the short setup wizard from reaching an
// activation win. A deferred starting point completes setup, but never counts as
// a completed launch task.
export const STARTING_POINT_RESOURCE_TYPES = ['board', 'messenger', 'article', 'none'] as const
export type StartingPointResourceType = (typeof STARTING_POINT_RESOURCE_TYPES)[number]

export const STARTING_POINT_SOURCES = ['wizard', 'managed', 'existing'] as const
export type StartingPointSource = (typeof STARTING_POINT_SOURCES)[number]

export const STARTING_POINT_RESOLUTIONS = [
  'created',
  'configured',
  'deferred',
  'unavailable',
] as const
export type StartingPointResolution = (typeof STARTING_POINT_RESOLUTIONS)[number]

export interface StartingPointState {
  outcome: OnboardingOutcome
  resourceType: StartingPointResourceType
  resourceId?: string
  source: StartingPointSource
  resolution: StartingPointResolution
  completedAt: string
}

export type LaunchTaskResolutionKind = 'deferred' | 'dismissed'
export interface LaunchTaskResolution {
  resolution: LaunchTaskResolutionKind
  resolvedAt: string
}
export type OutcomeTaskResolutions = Partial<
  Record<OnboardingOutcome, Record<string, LaunchTaskResolution>>
>

export type SetupCompletionSource = 'wizard' | 'managed' | 'legacy'

export interface SetupState {
  version: 2
  steps: {
    core: boolean
    workspace: boolean
    startingPoint: StartingPointState | null
  }
  completedAt?: string
  /** ICP outcome for setup and activation personalization. */
  useCase?: OnboardingOutcome
  completionSource?: SetupCompletionSource
  /** Set only after the one-time setup-to-activation bridge has been acknowledged. */
  activationHandoffSeenAt?: string
  /** Required tasks may be deferred; optional polish alone may be dismissed. */
  taskResolutions?: OutcomeTaskResolutions
}

export const DEFAULT_SETUP_STATE: SetupState = {
  version: 2,
  steps: {
    core: true,
    workspace: false,
    startingPoint: null,
  },
}

const LEGACY_POLISH_TASK_IDS = new Set([
  'customize-branding',
  'status-component',
  'connect-integration',
])
const LEGACY_HANDOFF_TIME = '1970-01-01T00:00:00.000Z'

/** Collapse a stored legacy use-case onto the four V2 outcomes. */
export function normalizeOnboardingOutcome(
  useCase?: UseCaseType | string | null
): OnboardingOutcome | undefined {
  if (!useCase) return undefined
  if ((ONBOARDING_OUTCOMES as readonly string[]).includes(useCase)) {
    return useCase as OnboardingOutcome
  }
  if (useCase === 'saas' || useCase === 'consumer' || useCase === 'marketplace') {
    return 'product_feedback'
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asIsoString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return Number.isNaN(Date.parse(value)) ? undefined : value
}

function normalizeStartingPoint(value: unknown): StartingPointState | null {
  if (!isRecord(value)) return null
  const outcome = normalizeOnboardingOutcome(
    typeof value.outcome === 'string' ? value.outcome : undefined
  )
  if (!outcome) return null
  if (!(STARTING_POINT_RESOURCE_TYPES as readonly unknown[]).includes(value.resourceType))
    return null
  if (!(STARTING_POINT_SOURCES as readonly unknown[]).includes(value.source)) return null
  if (!(STARTING_POINT_RESOLUTIONS as readonly unknown[]).includes(value.resolution)) return null
  const completedAt = asIsoString(value.completedAt)
  if (!completedAt) return null
  return {
    outcome,
    resourceType: value.resourceType as StartingPointResourceType,
    ...(typeof value.resourceId === 'string' && value.resourceId
      ? { resourceId: value.resourceId }
      : {}),
    source: value.source as StartingPointSource,
    resolution: value.resolution as StartingPointResolution,
    completedAt,
  }
}

function normalizeTaskResolutions(value: unknown): OutcomeTaskResolutions | undefined {
  if (!isRecord(value)) return undefined
  const result: OutcomeTaskResolutions = {}
  for (const outcome of ONBOARDING_OUTCOMES) {
    const stored = value[outcome]
    if (!isRecord(stored)) continue
    const tasks: Record<string, LaunchTaskResolution> = {}
    for (const [taskId, resolution] of Object.entries(stored)) {
      if (!isRecord(resolution)) continue
      if (resolution.resolution !== 'deferred' && resolution.resolution !== 'dismissed') continue
      const resolvedAt = asIsoString(resolution.resolvedAt)
      if (!resolvedAt) continue
      tasks[taskId] = { resolution: resolution.resolution, resolvedAt }
    }
    if (Object.keys(tasks).length > 0) result[outcome] = tasks
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Pure, deterministic V1-to-V2 normalizer. Reads never write; the normalized
 * representation is persisted by the next setup-state mutation.
 *
 * Completed V1 tenants are marked as already having seen the handoff so an
 * upgrade cannot unexpectedly redirect an established workspace back into
 * onboarding. The epoch fallback is intentionally stable for rows that lack a
 * completion timestamp.
 */
export function normalizeSetupStateV2(value: unknown): SetupState | null {
  if (!isRecord(value)) return null
  const steps = isRecord(value.steps) ? value.steps : {}
  const useCase = normalizeOnboardingOutcome(
    typeof value.useCase === 'string' ? value.useCase : undefined
  )

  if (value.version === 2) {
    const startingPoint = normalizeStartingPoint(steps.startingPoint)
    const taskResolutions = normalizeTaskResolutions(value.taskResolutions)
    const completionSource =
      value.completionSource === 'wizard' ||
      value.completionSource === 'managed' ||
      value.completionSource === 'legacy'
        ? value.completionSource
        : undefined
    return {
      version: 2,
      steps: {
        core: steps.core === true,
        workspace: steps.workspace === true,
        startingPoint,
      },
      ...(asIsoString(value.completedAt) ? { completedAt: value.completedAt as string } : {}),
      ...(useCase ? { useCase } : {}),
      ...(completionSource ? { completionSource } : {}),
      ...(asIsoString(value.activationHandoffSeenAt)
        ? { activationHandoffSeenAt: value.activationHandoffSeenAt as string }
        : {}),
      ...(taskResolutions ? { taskResolutions } : {}),
    }
  }

  const legacyComplete = steps.core === true && steps.workspace === true && steps.boards === true
  const completedAt = asIsoString(value.completedAt)
  const migrationTime = completedAt ?? LEGACY_HANDOFF_TIME
  const outcome = useCase ?? 'product_feedback'
  const knownCompletionSource =
    value.completionSource === 'wizard' || value.completionSource === 'managed'
      ? value.completionSource
      : 'legacy'
  const skipped = Array.isArray(value.skippedLaunchTasks)
    ? value.skippedLaunchTasks.filter((task): task is string => typeof task === 'string')
    : []
  const migratedTasks: Record<string, LaunchTaskResolution> = {}
  for (const taskId of skipped) {
    migratedTasks[taskId] = {
      resolution: LEGACY_POLISH_TASK_IDS.has(taskId) ? 'dismissed' : 'deferred',
      resolvedAt: migrationTime,
    }
  }

  return {
    version: 2,
    steps: {
      core: steps.core === true,
      workspace: steps.workspace === true,
      startingPoint: legacyComplete
        ? {
            outcome,
            resourceType: 'none',
            source: 'existing',
            resolution: 'deferred',
            completedAt: migrationTime,
          }
        : null,
    },
    ...(completedAt ? { completedAt } : {}),
    ...(useCase ? { useCase } : {}),
    ...(legacyComplete ? { completionSource: knownCompletionSource } : {}),
    ...(legacyComplete ? { activationHandoffSeenAt: migrationTime } : {}),
    ...(Object.keys(migratedTasks).length > 0
      ? { taskResolutions: { [outcome]: migratedTasks } }
      : {}),
  }
}

export function getSetupState(setupStateJson: string | null): SetupState | null {
  if (!setupStateJson) return null
  try {
    return normalizeSetupStateV2(JSON.parse(setupStateJson))
  } catch {
    return null
  }
}

export function isOnboardingComplete(setupState: SetupState | null): boolean {
  return Boolean(
    setupState?.steps.core && setupState.steps.workspace && setupState.steps.startingPoint
  )
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

// Post tag types (catalog + assignment junction)
export type PostTag = InferSelectModel<typeof postTags>
export type NewPostTag = InferInsertModel<typeof postTags>
export type PostTagAssignment = InferSelectModel<typeof postTagAssignments>
export type NewPostTagAssignment = InferInsertModel<typeof postTagAssignments>

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
export type PostVote = InferSelectModel<typeof postVotes>
export type NewPostVote = InferInsertModel<typeof postVotes>

// Comment types
export type PostComment = InferSelectModel<typeof postComments>
export type NewPostComment = InferInsertModel<typeof postComments>

// Post note types (internal staff notes)
export type PostNote = InferSelectModel<typeof postNotes>
export type NewPostNote = InferInsertModel<typeof postNotes>

// Comment reaction types
export type PostCommentReaction = InferSelectModel<typeof postCommentReactions>
export type NewPostCommentReaction = InferInsertModel<typeof postCommentReactions>

// Support-inbox conversation statuses — kept in sync with the conversations.status
// column enum (schema.test.ts pins the match). 'snoozed' is a deferred-work state
// with an explicit conversations.snoozed_until wake time (NULL = snoozed until the
// customer next replies); it replaced the earlier 'pending' in migration 0139.
export const CONVERSATION_STATUSES = ['open', 'snoozed', 'closed'] as const
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

// The inbound channel a conversation arrived on — kept in sync with the
// conversations.channel column enum. Pre-rename widget threads default to
// 'messenger'; 'email' and 'web_form' are wired up in later phases. This keeps
// one polymorphic conversation object with a channel field, not a per-channel table.
export const CHANNELS = ['messenger', 'email', 'web_form'] as const
export type Channel = (typeof CHANNELS)[number]

// Agent-set conversation priority for inbox triage — kept in sync with the
// conversations.priority column enum. 'none' = unset (the default).
export const CONVERSATION_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
export type ConversationPriority = (typeof CONVERSATION_PRIORITIES)[number]

// Ticket kind (support platform §4.2) — kept in sync with the tickets.type column
// enum. 'customer' is the customer-visible support request (at most one per
// conversation); 'back_office' is an internal task; 'tracker' is an umbrella that
// fans work out to linked tickets via ticket_links.
export const TICKET_TYPES = ['customer', 'back_office', 'tracker'] as const
export type TicketType = (typeof TICKET_TYPES)[number]

// Coarse lifecycle bucket a ticket status rolls up to for reporting and inbox
// grouping — kept in sync with the ticket_statuses.category column enum.
export const TICKET_STATUS_CATEGORIES = ['open', 'pending', 'closed'] as const
export type TicketStatusCategory = (typeof TICKET_STATUS_CATEGORIES)[number]

// Requester-facing stage a ticket status projects to (ticket_statuses.public_stage).
// A NULL public_stage hides the status from the requester entirely; these values
// are the only labels a customer ever sees, decoupled from internal status names.
export const TICKET_STAGES = ['received', 'in_progress', 'awaiting_requester', 'resolved'] as const
export type TicketStage = (typeof TICKET_STAGES)[number]

// How a team-assigned conversation picks a member — kept in sync with the
// teams.assignment_method column enum. 'manual' assigns the team only (no
// member pick); 'round_robin' rotates over online members; 'balanced' reuses
// the least-loaded auto-assign strategy scoped to the team's members.
export const TEAM_ASSIGNMENT_METHODS = ['manual', 'round_robin', 'balanced'] as const
export type TeamAssignmentMethod = (typeof TEAM_ASSIGNMENT_METHODS)[number]

// Which side of a conversation a message came from — kept in sync with the
// conversation_messages.sender_type column enum. 'system' rows are status events (e.g.
// assignment) shown to both sides; attributed to the relevant agent's principal
// and never counted as unread.
export const MESSAGE_SENDER_TYPES = ['visitor', 'agent', 'system'] as const
export type MessageSenderType = (typeof MESSAGE_SENDER_TYPES)[number]

// A single attachment ref stored on a conversation message (conversation_messages.attachments).
export interface ConversationAttachment {
  url: string
  name: string
  contentType: string
  size: number
}

// A source the AI assistant grounded a message in (conversation_messages.citations).
// The message text carries inline [n] markers that index into this ordered list.
export interface ConversationMessageCitation {
  type: 'article' | 'post' | 'snippet' | 'summary'
  id: string
  title: string
  url: string
}

// Channel provenance stored on a conversation message (conversation_messages.metadata).
// Null for ordinary in-app messenger messages; set when a message arrives over
// another channel so the inbox can render it and dedupe provider retries.
/** Author-less 'system' status events (conversation ended/reopened, assignment). */
// NOTE: the stored kind values keep the chat_ prefix until the Phase B data
// migration rewrites conversation_messages.metadata.
export type ConversationSystemEventKind =
  | 'chat_ended'
  | 'chat_reopened'
  | 'assigned'
  | 'assistant_handoff'
  | 'ticket_status_changed'
  | 'ticket_linked'
  | 'ticket_created'
  | 'assistant_action_expired'
  | 'external_linked'
  | 'external_unlinked'

export interface ConversationSystemEvent {
  kind: ConversationSystemEventKind
  /** Assignee display name for 'assigned'. */
  agentName?: string
  /** Customer-facing stage label for 'ticket_status_changed' (never the raw
   *  internal status name). */
  stageLabel?: string
  /** Tracker reference (e.g. "#12") for 'ticket_linked' — team-only. */
  trackerReference?: string
  /** Ticket reference (e.g. "#42") for 'ticket_created' (unified inbox M5's
   *  create-ticket flow) — team-only, the ticket itself may not be visible to
   *  the customer. */
  ticketReference?: string
  /** External issue reference (e.g. "acme/widgets#142") for
   *  'external_linked' / 'external_unlinked' — team-only. */
  externalReference?: string
  /** External issue URL for 'external_linked' / 'external_unlinked' — team-only. */
  externalUrl?: string
}

// An agent-only suggestion (carried on an internal note) to track a resolved
// conversation as a feedback post. Surfaced exclusively via the agent DTO — it
// never reaches the visitor.
export interface PostSuggestion {
  boardId: string
  title: string
  content: string
}

// A write-tool call Quinn proposed but has not executed, surfaced on an
// internal note (conversation_messages.metadata) so the team sees it without
// polling. A point-in-time snapshot only — the pending action row is the live
// source of truth an agent approves/rejects from.
export interface AssistantPendingActionSurface {
  pendingActionId: string
  toolName: string
  summary: string
}

// Workflow conversational-block layer (Phase C, slice C-1). A block is an
// ordinary senderType:'agent' message authored by the assistant service
// principal; its structured shape lives in metadata.block, mirroring the
// systemEvent precedent — content ALWAYS carries an honest plain-text
// fallback, contentJson carries the resolved rich prompt body (variables
// already substituted server-side; a raw {token} never reaches storage).
export type WorkflowBlockKind =
  | 'message'
  | 'buttons'
  | 'collect'
  | 'collectReply'
  | 'csat'
  | 'replyTime'

/** Block kinds that park the run awaiting a customer reply — the only ones
 *  that ever produce a BlockState (widget conversation-rows.ts's derivation)
 *  or need an active-run check before continuing (the engine's
 *  action.executor.ts). The remaining kinds (message/replyTime) post and
 *  continue immediately. */
export const INTERACTIVE_BLOCK_KINDS: ReadonlySet<WorkflowBlockKind> = new Set([
  'buttons',
  'collect',
  'collectReply',
  'csat',
])

/** The five CSAT satisfaction faces, low to high — index = rating-1. The one
 *  canonical order/glyph set every surface that renders or echoes a CSAT
 *  rating shares: the widget's block affordance row, the admin inbox's
 *  read-only summary, the server's stored-reply echo + honest plain-text
 *  fallback, and the workflow builder's rating-path labels. */
export const CSAT_FACES = ['😞', '🙁', '😐', '🙂', '😄'] as const

interface WorkflowBlockPayloadBase {
  /** Payload schema version, so a future shape change can branch on it. */
  v: 1
  /** The workflow run that posted this block. */
  runId: string
  /** The graph node that posted this block. */
  nodeId: string
  /** True for an interactive kind that parked the run awaiting this exact
   *  reply (buttons/collect/collectReply/csat); false for a SEND kind
   *  (message/replyTime) that posted and continued immediately. */
  waiting: boolean
}

export interface WorkflowBlockButtonOption {
  key: string
  label: string
}

/** A snapshot of one collect-data option (select/multi_select fields), so a
 *  later definition edit can't retroactively change what the customer chose
 *  from. */
export interface WorkflowBlockAttributeOption {
  id: string
  label: string
}

export type WorkflowBlockPayload =
  | (WorkflowBlockPayloadBase & { kind: 'message' })
  | (WorkflowBlockPayloadBase & {
      kind: 'buttons'
      options: WorkflowBlockButtonOption[]
      allowTyping: boolean
    })
  | (WorkflowBlockPayloadBase & {
      kind: 'collect'
      attributeKey: string
      fieldType: 'text' | 'number' | 'select' | 'date'
      options?: WorkflowBlockAttributeOption[]
      required: boolean
    })
  | (WorkflowBlockPayloadBase & { kind: 'collectReply'; attributeKey: string })
  | (WorkflowBlockPayloadBase & {
      kind: 'csat'
      allowTypingInterrupt: boolean
      commentPrompt: string
    })
  | (WorkflowBlockPayloadBase & { kind: 'replyTime'; status: 'online' | 'away' })

/** The customer's structured reply to a block, stored on the VISITOR message
 *  it was sent as. `inReplyToMessageId` is the block message's own id — the
 *  correlation key (unique per park occurrence, collision-proof where
 *  runId+nodeId is not, since a graph can revisit the same node). */
export type BlockReplyMetadata =
  | { kind: 'buttons'; inReplyToMessageId: string; buttonKey: string }
  | { kind: 'collect'; inReplyToMessageId: string; value: string | number | boolean }
  | { kind: 'collectReply'; inReplyToMessageId: string; value: string }
  | { kind: 'csat'; inReplyToMessageId: string; rating: number; comment?: string }

export interface ConversationMessageMetadata {
  /** The channel this message arrived through, when not the in-app messenger. */
  source?: 'email'
  /** Provider Message-ID for an inbound email, used to dedupe webhook retries. */
  emailMessageId?: string
  /** RFC 5322 threading of an inbound email message: the parent it replied to
   *  and the full References chain (bare ids). Populated on the email channel. */
  inReplyTo?: string
  references?: string[]
  /** The email Subject + Cc participants at the time this message arrived
   *  (§4.8). Bcc is never stored — it is stripped at ingest. */
  subject?: string
  cc?: string[]
  /** For 'system' messages: the structured event, so clients can localize the
   *  notice instead of rendering the stored (English) content. */
  systemEvent?: ConversationSystemEvent
  /** Agent-only suggestion (on an internal note) to track this conversation as a
   *  feedback post. Surfaced only via the agent DTO, never to the visitor. */
  postSuggestion?: PostSuggestion
  /** Agent-only snapshot (on an internal note) of a write-tool proposal Quinn
   *  surfaced for approval. Surfaced only via the agent DTO, never to the visitor. */
  assistantPendingAction?: AssistantPendingActionSurface
  /** Agent-only (P2-D.1 inbox translation): set on an OUTGOING reply sent while
   *  translation was active for the conversation. `content`/`content_json` on
   *  this row are the customer-language translation actually sent; this
   *  preserves the teammate's pre-translation original so the team can toggle
   *  back to "Show original". Surfaced only via the agent DTO, never to the
   *  visitor. */
  translatedFrom?: TranslatedFromMetadata
  /** The structured block this assistant-authored message renders (Phase C
   *  conversational block layer). Null/absent for an ordinary message. */
  block?: WorkflowBlockPayload
  /** The structured reply this visitor-authored message carries, when it was
   *  sent in answer to a block. Null/absent for an ordinary message. */
  blockReply?: BlockReplyMetadata
}

/** See `ConversationMessageMetadata.translatedFrom`. */
export interface TranslatedFromMetadata {
  /** The teammate's original, pre-translation text. */
  originalContent: string
  /** The teammate's own language at send time (their preference, or the
   *  'en' fallback when unset). */
  sourceLocale: string
  /** The customer's language the reply was translated (and sent) into —
   *  matches this message's actual stored `content`. */
  targetLocale: string
}

// Support-inbox conversation row types
export type Conversation = InferSelectModel<typeof conversations>
export type NewConversation = InferInsertModel<typeof conversations>
export type ConversationMessage = InferSelectModel<typeof conversationMessages>
export type NewConversationMessage = InferInsertModel<typeof conversationMessages>
export type ConversationTag = InferSelectModel<typeof conversationTags>
export type NewConversationTag = InferInsertModel<typeof conversationTags>
export type ConversationMessageMention = InferSelectModel<typeof conversationMessageMentions>
export type NewConversationMessageMention = InferInsertModel<typeof conversationMessageMentions>
export type ConversationMessageReaction = InferSelectModel<typeof conversationMessageReactions>
export type NewConversationMessageReaction = InferInsertModel<typeof conversationMessageReactions>
export type ConversationMessageFlag = InferSelectModel<typeof conversationMessageFlags>
export type NewConversationMessageFlag = InferInsertModel<typeof conversationMessageFlags>
export type ConversationMessageTranslation = InferSelectModel<
  typeof conversationMessageTranslations
>
export type NewConversationMessageTranslation = InferInsertModel<
  typeof conversationMessageTranslations
>

// Teams (§4.12) row types
export type Team = InferSelectModel<typeof teams>
export type NewTeam = InferInsertModel<typeof teams>
export type TeamMember = InferSelectModel<typeof teamMembers>
export type NewTeamMember = InferInsertModel<typeof teamMembers>

// Tickets (§4.2) row types
export type Ticket = InferSelectModel<typeof tickets>
export type NewTicket = InferInsertModel<typeof tickets>
export type TicketStatusEntity = InferSelectModel<typeof ticketStatuses>
export type NewTicketStatusEntity = InferInsertModel<typeof ticketStatuses>
export type TicketConversation = InferSelectModel<typeof ticketConversations>
export type NewTicketConversation = InferInsertModel<typeof ticketConversations>
export type TicketLink = InferSelectModel<typeof ticketLinks>
export type NewTicketLink = InferInsertModel<typeof ticketLinks>
export type TicketActivityEntity = InferSelectModel<typeof ticketActivity>
export type NewTicketActivityEntity = InferInsertModel<typeof ticketActivity>

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

// Principal types
export type Principal = InferSelectModel<typeof principal>
export type NewPrincipal = InferInsertModel<typeof principal>

// Extended types for queries with relations
export type CommentWithReplies = Comment & {
  replies: CommentWithReplies[]
  reactions: PostCommentReaction[]
}

export type PostWithDetails = Post & {
  board: Board
  tags: PostTag[]
  roadmaps: Roadmap[]
  comments: CommentWithReplies[]
  votes: PostVote[]
}

// Inbox query types
export type PostListItem = Post & {
  board: Pick<Board, 'id' | 'name' | 'slug'>
  tags: Pick<PostTag, 'id' | 'name' | 'color'>[]
  commentCount: number
  authorName: string | null
}

export interface InboxPostListResult {
  items: PostListItem[]
  nextCursor: string | null
  hasMore: boolean
}
