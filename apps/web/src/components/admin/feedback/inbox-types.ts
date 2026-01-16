import type { Board, Tag, Comment } from '@/lib/db-types'
import type { PostId, StatusId, CommentId, MemberId } from '@quackback/ids'

export interface OfficialResponse {
  content: string
  authorName: string | null
  respondedAt: Date
}

export interface PinnedComment {
  id: CommentId
  content: string
  authorName: string | null
  memberId: MemberId | null
  avatarUrl: string | null
  createdAt: Date
  isTeamMember: boolean
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
  id: PostId
  title: string
  content: string
  contentJson?: unknown
  statusId: StatusId | null
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
  /** Pinned comment as official response (new approach) */
  pinnedComment: PinnedComment | null
  /** ID of the pinned comment (for UI to identify which comment is pinned) */
  pinnedCommentId: CommentId | null
  /** Map of memberId to avatar URL (base64 or external URL) */
  avatarUrls?: Record<string, string | null>
  /** IDs of roadmaps this post belongs to */
  roadmapIds?: string[]
  /** When the post was soft-deleted (null if not deleted) */
  deletedAt?: Date | null
  /** Name of the member who deleted the post */
  deletedByMemberName?: string | null
}

export interface CurrentUser {
  name: string
  email: string
  memberId: string
}
