import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type { boards, roadmaps, tags } from './schema/boards'
import type { postStatuses, STATUS_CATEGORIES, StatusCategory } from './schema/statuses'
import type {
  posts,
  postTags,
  postRoadmaps,
  votes,
  comments,
  commentReactions,
} from './schema/posts'
import type { integrations } from './schema/integrations'
import type { changelogEntries } from './schema/changelog'

// Re-export status types
export type { StatusCategory }
export { STATUS_CATEGORIES }

// Board types
export type Board = InferSelectModel<typeof boards>
export type NewBoard = InferInsertModel<typeof boards>

// Board settings (stored in boards.settings JSONB column)
export interface BoardSettings {
  publicVoting?: boolean // default: true
  publicCommenting?: boolean // default: true
  roadmapStatuses?: PostStatus[] // default: ['planned', 'in_progress', 'complete']
  allowAnonymousPosts?: boolean // default: false
  allowUserSubmissions?: boolean // default: true - allow authenticated users (role='user') to submit posts
}

// Helper to get typed board settings with defaults
export function getBoardSettings(board: Board): Required<BoardSettings> {
  const settings = (board.settings || {}) as BoardSettings
  return {
    publicVoting: settings.publicVoting ?? true,
    publicCommenting: settings.publicCommenting ?? true,
    roadmapStatuses: settings.roadmapStatuses ?? ['planned', 'in_progress', 'complete'],
    allowAnonymousPosts: settings.allowAnonymousPosts ?? false,
    allowUserSubmissions: settings.allowUserSubmissions ?? true,
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
export type PostStatus = Post['status']

// Post tag types
export type PostTag = InferSelectModel<typeof postTags>
export type NewPostTag = InferInsertModel<typeof postTags>

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
// ReactionEmoji and REACTION_EMOJIS are exported from schema/posts.ts

// Integration types
export type Integration = InferSelectModel<typeof integrations>
export type NewIntegration = InferInsertModel<typeof integrations>
export type IntegrationType = 'github' | 'slack' | 'discord'
export type IntegrationStatus = Integration['status']

// Changelog types
export type ChangelogEntry = InferSelectModel<typeof changelogEntries>
export type NewChangelogEntry = InferInsertModel<typeof changelogEntries>

// Extended types for queries with relations
export type PostWithTags = Post & {
  tags: Tag[]
}

export type PostWithRoadmaps = Post & {
  roadmaps: Roadmap[]
}

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

// Roadmap with its posts (for roadmap view)
export type RoadmapWithPosts = Roadmap & {
  posts: Post[]
}

export type BoardWithRoadmaps = Board & {
  roadmaps: Roadmap[]
}

// Inbox query types
export interface InboxPostListParams {
  organizationId: string
  boardIds?: string[]
  status?: PostStatus[]
  tagIds?: string[]
  ownerId?: string | null // null = unassigned
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
