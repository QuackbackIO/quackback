import { queryOptions } from '@tanstack/react-query'
import type { PostId, PostStatusId, PostCommentId, PrincipalId } from '@quackback/ids'
import {
  fetchPublicBoardBySlug,
  fetchPublicPostDetail,
  getCommentsSectionDataFn,
} from '@/lib/server/functions/portal'
import { getVoteSidebarDataFn, getVotedPostsFn } from '@/lib/server/functions/public-posts'
import type { CommentReactionCount, CommentStatusChange } from '@/lib/shared'
import type { TiptapContent } from '@/lib/shared/db-types'

/**
 * Comment type for client components (Date fields may be strings after serialization)
 */
export interface PublicCommentView {
  id: PostCommentId
  content: string
  contentJson?: TiptapContent | null
  authorName: string | null
  principalId: string | null
  createdAt: Date | string
  deletedAt: Date | string | null
  isRemovedByTeam: boolean
  parentId: PostCommentId | null
  isTeamMember: boolean
  isPrivate?: boolean
  isEdited: boolean
  avatarUrl: string | null
  statusChange?: CommentStatusChange | null
  replies: PublicCommentView[]
  reactions: CommentReactionCount[]
}

/**
 * Pinned comment for client components (Date fields may be strings after serialization)
 */
export interface PinnedCommentView {
  id: PostCommentId
  content: string
  contentJson?: TiptapContent | null
  authorName: string | null
  principalId: PrincipalId | null
  avatarUrl: string | null
  createdAt: Date | string
  isTeamMember: boolean
}

/**
 * Post detail type for client components (Date fields may be strings after serialization)
 */
export interface PublicPostDetailView {
  id: string
  title: string
  content: string
  contentJson: unknown
  statusId: PostStatusId | null
  voteCount: number
  authorName: string | null
  principalId: PrincipalId | null
  authorAvatarUrl: string | null
  createdAt: Date | string
  board: { id: string; name: string; slug: string }
  tags: Array<{ id: string; name: string; color: string }>
  roadmaps: Array<{ id: string; name: string; slug: string }>
  comments: PublicCommentView[]
  pinnedComment: PinnedCommentView | null
  pinnedCommentId: PostCommentId | null
  /** Whether comments are locked (portal users can't comment) */
  isCommentsLocked?: boolean
  /**
   * Server-computed per-board capability for the requesting viewer (composes
   * the board's vote/comment tier with the workspace anonymous switch). The
   * widget passes its Bearer identity to fetchPublicPostDetail and refetches on
   * identify, so these reflect the real viewer. Undefined only on legacy/cached
   * payloads — consumers should treat undefined as "not allowed".
   */
  canVote?: boolean
  canComment?: boolean
  /** Merge/deduplication: info about canonical post if this is a merged duplicate */
  mergeInfo?: {
    canonicalPostId: string
    canonicalPostTitle: string
    canonicalPostBoardSlug: string
    mergedAt: Date | string
  } | null
  /** Number of posts merged into this one (if canonical) */
  mergedPostCount?: number
}

/**
 * Query options factory for portal detail pages (board, post detail).
 * Uses server functions to keep database code server-only.
 * These are used with ensureQueryData() in loaders and useSuspenseQuery() in components.
 */
export const portalDetailQueries = {
  /**
   * Get public board by slug
   */
  board: (slug: string) =>
    queryOptions({
      queryKey: ['portal', 'board', slug],
      queryFn: async () => {
        const result = await fetchPublicBoardBySlug({ data: { slug } })
        if (!result) throw new Error('Board not found')
        return result
      },
      staleTime: 2 * 60 * 1000, // 2min
    }),

  /**
   * Get public post detail
   */
  postDetail: (postId: PostId) =>
    queryOptions({
      queryKey: ['portal', 'post', postId],
      queryFn: async (): Promise<PublicPostDetailView> => {
        const result = await fetchPublicPostDetail({ data: { postId } })
        if (!result) throw new Error('Post not found')
        return result as PublicPostDetailView
      },
      staleTime: 30 * 1000, // 30s
    }),

  /**
   * Get vote sidebar data (membership, vote status, subscription status)
   * Used for SSR prefetching and client-side Suspense queries
   */
  voteSidebarData: (postId: PostId) =>
    queryOptions({
      queryKey: ['vote-sidebar', postId],
      queryFn: () => getVoteSidebarDataFn({ data: { postId } }),
      staleTime: 30 * 1000, // 30s
    }),

  /**
   * Get comments section data (canComment, user)
   * Avatar data is now included directly in comments from getPublicPostDetail
   * Used for SSR prefetching and client-side Suspense queries
   */
  commentsSectionData: (postId: PostId) =>
    queryOptions({
      queryKey: ['comments-section', postId],
      queryFn: () => getCommentsSectionDataFn({ data: { postId } }),
      staleTime: 60 * 1000, // 1min
    }),

  /**
   * Get all post IDs the user has voted on
   * Used for SSR prefetching - key must match votedPostsKeys.byWorkspace()
   */
  votedPosts: () =>
    queryOptions({
      queryKey: ['votedPosts'] as const,
      queryFn: async () => {
        const result = await getVotedPostsFn()
        return new Set(result.votedPostIds)
      },
      staleTime: 5 * 60 * 1000, // 5min
    }),
}
