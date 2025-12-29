import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type { BoardId, TagId, StatusId } from '@quackback/ids'
import type { boards, roadmaps, tags } from './schema/boards'
import type { postStatuses } from './schema/statuses'
import type { posts, postRoadmaps, votes, comments, commentReactions } from './schema/posts'
import type { integrations } from './schema/integrations'
import type { changelogEntries } from './schema/changelog'
import type { member } from './schema/auth'

// Status categories (defined here to avoid circular imports in tests)
export const STATUS_CATEGORIES = ['active', 'complete', 'closed'] as const
export type StatusCategory = (typeof STATUS_CATEGORIES)[number]

// Board types
export type Board = InferSelectModel<typeof boards>
export type NewBoard = InferInsertModel<typeof boards>

// Board settings (stored in boards.settings JSONB column)
export interface BoardSettings {
  roadmapStatusIds?: StatusId[] // Status IDs to show on roadmap
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
