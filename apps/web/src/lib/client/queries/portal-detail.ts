import { queryOptions } from '@tanstack/react-query'
import type { PostId, StatusId, CommentId, MemberId } from '@quackback/ids'
import {
  fetchPublicBoardBySlug,
  fetchPublicPostDetail,
  getCommentsSectionDataFn,
} from '@/lib/server/functions/portal'
import { getVoteSidebarDataFn, getVotedPostsFn } from '@/lib/server/functions/public-posts'
import type { CommentReactionCount } from '@/lib/shared'

/**
 * Comment type for client components (Date fields may be strings after serialization)
 */
export interface PublicCommentView {
  id: CommentId
  content: string
  authorName: string | null
  memberId: string | null
  createdAt: Date | string
  parentId: CommentId | null
  isTeamMember: boolean
  avatarUrl: string | null
  replies: PublicCommentView[]
  reactions: CommentReactionCount[]
}

/**
 * Pinned comment for client components (Date fields may be strings after serialization)
 */
export interface PinnedCommentView {
  id: CommentId
  content: string
  authorName: string | null
  memberId: MemberId | null
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
  statusId: StatusId | null
  voteCount: number
  authorName: string | null
  memberId: MemberId | null
  authorAvatarUrl: string | null
  createdAt: Date | string
  board: { id: string; name: string; slug: string }
  tags: Array<{ id: string; name: string; color: string }>
  roadmaps: Array<{ id: string; name: string; slug: string }>
  comments: PublicCommentView[]
  officialResponse: {
    content: string
    authorName: string | null
    respondedAt: Date | string
  } | null
  pinnedComment: PinnedCommentView | null
  pinnedCommentId: CommentId | null
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
      queryFn: () => getCommentsSectionDataFn(),
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
