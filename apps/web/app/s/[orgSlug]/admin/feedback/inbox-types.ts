import type { PostStatus, Board, Tag, Comment } from '@quackback/db/types'

export interface OfficialResponse {
  content: string
  authorName: string | null
  respondedAt: Date
}

export interface CommentReaction {
  emoji: string
  count: number
  hasReacted: boolean
}

export interface CommentWithReplies extends Comment {
  replies: CommentWithReplies[]
  reactions: CommentReaction[]
}

export interface PostDetails {
  id: string
  title: string
  content: string
  contentJson?: unknown
  status: PostStatus
  voteCount: number
  hasVoted: boolean
  // Member-scoped identity (Hub-and-Spoke model)
  memberId: string | null
  ownerMemberId: string | null
  // Legacy/anonymous identity fields
  authorName: string | null
  authorEmail: string | null
  ownerId: string | null
  createdAt: Date
  board: Pick<Board, 'id' | 'name' | 'slug'>
  tags: Pick<Tag, 'id' | 'name' | 'color'>[]
  comments: CommentWithReplies[]
  officialResponse: OfficialResponse | null
  /** Map of memberId to avatar URL (base64 or external URL) */
  avatarUrls?: Record<string, string | null>
  /** IDs of roadmaps this post belongs to */
  roadmapIds?: string[]
}

export interface CurrentUser {
  name: string
  email: string
}
