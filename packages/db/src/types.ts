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
} from './schema/conversation'
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
  useCase?: UseCaseType // Product type for personalized board recommendations
}

export const DEFAULT_SETUP_STATE: SetupState = {
  version: 1,
  steps: {
    core: true,
    workspace: false,
    boards: false,
  },
}

// Helper to parse setup state from settings
export function getSetupState(setupStateJson: string | null): SetupState | null {
  if (!setupStateJson) return null
  try {
    return JSON.parse(setupStateJson) as SetupState
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

// The inbound channel a conversation arrived on — kept in sync with the
// conversations.channel column enum. Existing live-chat threads default to
// 'messenger'; 'email' and 'web_form' are wired up in later phases. This turns
// "live chat vs ticket" into one polymorphic conversation with a channel field.
export const CHANNELS = ['messenger', 'email', 'web_form'] as const
export type Channel = (typeof CHANNELS)[number]

// Agent-set conversation priority for inbox triage — kept in sync with the
// conversations.priority column enum. 'none' = unset (the default).
export const CONVERSATION_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
export type ConversationPriority = (typeof CONVERSATION_PRIORITIES)[number]

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

// Channel provenance stored on a conversation message (conversation_messages.metadata).
// Null for ordinary in-app messenger messages; set when a message arrives over
// another channel so the inbox can render it and dedupe provider retries.
/** Author-less 'system' status events (conversation ended/reopened, assignment). */
// NOTE: the stored kind values keep the chat_ prefix until the Phase B data
// migration rewrites conversation_messages.metadata.
export type ConversationSystemEventKind = 'chat_ended' | 'chat_reopened' | 'assigned'

export interface ConversationSystemEvent {
  kind: ConversationSystemEventKind
  /** Assignee display name for 'assigned'. */
  agentName?: string
}

// An agent-only suggestion (carried on an internal note) to track a resolved
// conversation as a feedback post. Surfaced exclusively via the agent DTO — it
// never reaches the visitor.
export interface PostSuggestion {
  boardId: string
  title: string
  content: string
}

export interface ConversationMessageMetadata {
  /** The channel this message arrived through, when not in-app live chat. */
  source?: 'email'
  /** Provider Message-ID for an inbound email, used to dedupe webhook retries. */
  emailMessageId?: string
  /** For 'system' messages: the structured event, so clients can localize the
   *  notice instead of rendering the stored (English) content. */
  systemEvent?: ConversationSystemEvent
  /** Agent-only suggestion (on an internal note) to track this conversation as a
   *  feedback post. Surfaced only via the agent DTO, never to the visitor. */
  postSuggestion?: PostSuggestion
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
