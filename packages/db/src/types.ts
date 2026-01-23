import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type { BoardId, TagId, StatusId } from '@quackback/ids'
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
import type { changelogEntries } from './schema/changelog'
import type { member } from './schema/auth'
import type { billingSubscriptions, invoices } from './schema/billing'

// Status categories (defined here to avoid circular imports in tests)
export const STATUS_CATEGORIES = ['active', 'complete', 'closed'] as const
export type StatusCategory = (typeof STATUS_CATEGORIES)[number]

// Moderation states for posts (e.g., for imported content filtering)
export const MODERATION_STATES = ['published', 'pending', 'spam', 'archived'] as const
export type ModerationState = (typeof MODERATION_STATES)[number]

// Board types
export type Board = InferSelectModel<typeof boards>
export type NewBoard = InferInsertModel<typeof boards>

// Board settings (stored in boards.settings JSONB column)
export interface BoardSettings {
  roadmapStatusIds?: StatusId[] // Status IDs to show on roadmap
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

// Reaction emoji constants (client-safe)
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '👀'] as const
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

// Integration types
export type Integration = InferSelectModel<typeof integrations>
export type NewIntegration = InferInsertModel<typeof integrations>
export type IntegrationType = 'slack' | 'discord' | 'linear' | 'jira' | 'github'
export type IntegrationStatus = Integration['status']

// Changelog types
export type ChangelogEntry = InferSelectModel<typeof changelogEntries>
export type NewChangelogEntry = InferInsertModel<typeof changelogEntries>

// Member types
export type Member = InferSelectModel<typeof member>
export type NewMember = InferInsertModel<typeof member>

// Subscription types (cloud billing)
export type Subscription = InferSelectModel<typeof billingSubscriptions>
export type NewSubscription = InferInsertModel<typeof billingSubscriptions>

// Invoice types (cloud billing)
export type Invoice = InferSelectModel<typeof invoices>
export type NewInvoice = InferInsertModel<typeof invoices>

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
export interface InboxPostListParams {
  boardIds?: BoardId[]
  statusIds?: StatusId[]
  tagIds?: TagId[]
  ownerId?: string | null // null = unassigned (legacy field, raw text)
  search?: string
  dateFrom?: Date
  dateTo?: Date
  minVotes?: number
  sort?: 'newest' | 'oldest' | 'votes'
  page?: number
  limit?: number
}

export type PostListItem = Post & {
  board: Pick<Board, 'id' | 'name' | 'slug'>
  tags: Pick<Tag, 'id' | 'name' | 'color'>[]
  commentCount: number
}

export interface InboxPostListResult {
  items: PostListItem[]
  total: number
  hasMore: boolean
}
