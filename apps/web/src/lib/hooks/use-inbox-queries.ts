import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import {
  fetchInboxPostsForAdmin,
  fetchPostWithDetails,
  changePostStatusFn,
  updatePostFn,
  updatePostTagsFn,
  createPostFn,
} from '@/lib/server-functions/posts'
import { toggleVoteFn } from '@/lib/server-functions/public-posts'
import { createCommentFn, toggleReactionFn } from '@/lib/server-functions/comments'
import type { InboxFilters, PostDetails, CommentReaction, CommentWithReplies } from '@/lib/types'
import type { PostListItem, InboxPostListResult, Tag } from '@/lib/db-types'
import type { BoardId, CommentId, MemberId, PostId, StatusId, TagId } from '@quackback/ids'
import type { CreatePostInput } from '@/lib/posts'
import { roadmapPostsKeys } from './use-roadmap-posts-query'

// ============================================================================
// Types
// ============================================================================

interface UseInboxPostsOptions {
  filters: InboxFilters
  initialData?: InboxPostListResult
}

interface UsePostDetailOptions {
  postId: PostId | null
  enabled?: boolean
}

interface UpdateTagsInput {
  postId: PostId
  tagIds: string[]
  allTags: Tag[]
}

interface ToggleReactionInput {
  postId: PostId
  commentId: CommentId
  emoji: string
}

interface ToggleReactionResponse {
  reactions: CommentReaction[]
}

interface UpdatePostInput {
  postId: PostId
  title: string
  content: string
  contentJson: unknown
  statusId?: StatusId | null
  boardId?: string
  tagIds?: string[]
  allTags?: Tag[]
}

interface UpdatePostResponse {
  id: string
  title: string
  content: string
  contentJson: unknown
  statusId: StatusId | null
  boardId: string
}

interface VotePostResponse {
  voteCount: number
  voted: boolean
}

interface AddCommentInput {
  postId: string
  content: string
  parentId?: string | null
  authorName?: string | null
  authorEmail?: string | null
  memberId?: string | null
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const inboxKeys = {
  all: ['inbox'] as const,
  lists: () => [...inboxKeys.all, 'list'] as const,
  list: (filters: InboxFilters) => [...inboxKeys.lists(), filters] as const,
  details: () => [...inboxKeys.all, 'detail'] as const,
  detail: (postId: PostId) => [...inboxKeys.details(), postId] as const,
}

// ============================================================================
// Fetch Functions (using server actions)
// ============================================================================

async function fetchInboxPosts(filters: InboxFilters, page: number): Promise<InboxPostListResult> {
  return (await fetchInboxPostsForAdmin({
    data: {
      boardIds: filters.board as BoardId[] | undefined,
      statusSlugs: filters.status,
      tagIds: filters.tags as TagId[] | undefined,
      ownerId: (filters.owner || undefined) as MemberId | null | undefined,
      search: filters.search,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      minVotes: filters.minVotes,
      sort: filters.sort || 'newest',
      page,
      limit: 20,
    },
  })) as unknown as InboxPostListResult
}

async function fetchPostDetail(postId: PostId): Promise<PostDetails> {
  return (await fetchPostWithDetails({
    data: {
      id: postId,
    },
  })) as unknown as PostDetails
}

// ============================================================================
// Query Hooks
// ============================================================================

export function useInboxPosts({ filters, initialData }: UseInboxPostsOptions) {
  return useInfiniteQuery({
    queryKey: inboxKeys.list(filters),
    queryFn: ({ pageParam }) => fetchInboxPosts(filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    initialData: initialData
      ? {
          pages: [initialData],
          pageParams: [1],
        }
      : undefined,
    refetchOnMount: !initialData,
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Flatten paginated posts into a single array */
export function flattenInboxPosts(
  data: InfiniteData<InboxPostListResult> | undefined
): PostListItem[] {
  if (!data) return []
  return data.pages.flatMap((page) => page.items)
}

export function usePostDetail({ postId, enabled = true }: UsePostDetailOptions) {
  return useQuery({
    queryKey: inboxKeys.detail(postId!),
    queryFn: () => fetchPostDetail(postId!),
    enabled: enabled && !!postId,
    staleTime: 30 * 1000,
  })
}

// ============================================================================
// Cache Update Helpers
// ============================================================================

/** Rollback helper for mutations that update both detail and list caches */
function rollbackDetailAndLists<T>(
  queryClient: ReturnType<typeof useQueryClient>,
  postId: PostId,
  context?: {
    previousDetail?: T
    previousLists?: [readonly unknown[], InfiniteData<InboxPostListResult> | undefined][]
  }
): void {
  if (context?.previousDetail) {
    queryClient.setQueryData(inboxKeys.detail(postId), context.previousDetail)
  }
  if (context?.previousLists) {
    for (const [queryKey, data] of context.previousLists) {
      if (data) {
        queryClient.setQueryData(queryKey, data)
      }
    }
  }
}

/** Update a post in all list caches */
function updatePostInLists(
  queryClient: ReturnType<typeof useQueryClient>,
  postId: PostId,
  updater: (post: PostListItem) => PostListItem
): void {
  queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
    { queryKey: inboxKeys.lists() },
    (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          items: page.items.map((post) => (post.id === postId ? updater(post) : post)),
        })),
      }
    }
  )
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/** @deprecated Use useChangePostStatusId instead */
export const useUpdatePostStatus = useChangePostStatusId

/**
 * Hook to change a post's status using TypeID-based statusId
 */
export function useChangePostStatusId() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ postId, statusId }: { postId: PostId; statusId: StatusId }) =>
      changePostStatusFn({ data: { id: postId, statusId } }),
    onSuccess: (_data, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId) })
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
      queryClient.invalidateQueries({ queryKey: roadmapPostsKeys.all })
    },
  })
}

export function useUpdatePostOwner() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ postId, ownerId }: { postId: PostId; ownerId: MemberId | null }) =>
      updatePostFn({ data: { id: postId, ownerId } }),
    onMutate: async ({ postId, ownerId }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(inboxKeys.detail(postId))
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), {
          ...previousDetail,
          ownerId,
        })
      }
      updatePostInLists(queryClient, postId, (post) => ({ ...post, ownerId }))

      return { previousDetail, previousLists }
    },
    onError: (_err, { postId }, context) => {
      rollbackDetailAndLists(queryClient, postId, context)
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId) })
    },
  })
}

export function useUpdatePostTags() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ postId, tagIds }: UpdateTagsInput) =>
      updatePostTagsFn({ data: { id: postId, tagIds: tagIds as TagId[] } }),
    onMutate: async ({ postId, tagIds, allTags }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(inboxKeys.detail(postId))
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      const tagIdSet = new Set(tagIds)
      const mappedTags = allTags
        .filter((t) => tagIdSet.has(t.id))
        .map((t) => ({ id: t.id, name: t.name, color: t.color }))

      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), {
          ...previousDetail,
          tags: mappedTags,
        })
      }
      updatePostInLists(queryClient, postId, (post) => ({ ...post, tags: mappedTags }))

      return { previousDetail, previousLists }
    },
    onError: (_err, { postId }, context) => {
      rollbackDetailAndLists(queryClient, postId, context)
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId) })
    },
  })
}

// ============================================================================
// Comment Reaction Mutation
// ============================================================================

export function useToggleCommentReaction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      commentId,
      emoji,
    }: ToggleReactionInput): Promise<ToggleReactionResponse> => {
      const result = await toggleReactionFn({ data: { commentId, emoji } })
      // The action returns { added, reactions } from the domain service
      // reactions already has { emoji, count, hasReacted } for each reaction
      return { reactions: result.reactions }
    },
    onMutate: async ({ postId, commentId, emoji }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId) })

      const previousDetail = queryClient.getQueryData<PostDetails>(inboxKeys.detail(postId))

      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), {
          ...previousDetail,
          comments: updateCommentsReaction(previousDetail.comments, commentId, emoji),
        })
      }

      return { previousDetail }
    },
    onError: (_err, { postId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId), context.previousDetail)
      }
    },
    onSuccess: (data, { postId, commentId }) => {
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), (old) => {
        if (!old) return old
        return {
          ...old,
          comments: updateCommentReactionsFromServer(old.comments, commentId, data.reactions),
        }
      })
    },
  })
}

// Helper to optimistically update reactions in nested comment structure
function updateCommentsReaction(
  comments: CommentWithReplies[],
  commentId: CommentId,
  emoji: string
): CommentWithReplies[] {
  return comments.map((comment) => {
    if (comment.id === commentId) {
      const existingReaction = comment.reactions?.find((r) => r.emoji === emoji)
      let newReactions: CommentReaction[]

      if (existingReaction?.hasReacted) {
        newReactions = comment.reactions
          .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, hasReacted: false } : r))
          .filter((r) => r.count > 0)
      } else if (existingReaction) {
        newReactions = comment.reactions.map((r) =>
          r.emoji === emoji ? { ...r, count: r.count + 1, hasReacted: true } : r
        )
      } else {
        newReactions = [...(comment.reactions || []), { emoji, count: 1, hasReacted: true }]
      }

      return { ...comment, reactions: newReactions }
    }

    if (comment.replies?.length) {
      return {
        ...comment,
        replies: updateCommentsReaction(comment.replies, commentId, emoji),
      }
    }

    return comment
  })
}

// Helper to update reactions from server response
function updateCommentReactionsFromServer(
  comments: CommentWithReplies[],
  commentId: CommentId,
  reactions: CommentReaction[]
): CommentWithReplies[] {
  return comments.map((comment) => {
    if (comment.id === commentId) {
      return { ...comment, reactions }
    }

    if (comment.replies?.length) {
      return {
        ...comment,
        replies: updateCommentReactionsFromServer(comment.replies, commentId, reactions),
      }
    }

    return comment
  })
}

// ============================================================================
// Update Post Mutation (for edit dialog)
// ============================================================================

export function useUpdatePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      postId,
      title,
      content,
      contentJson,
    }: UpdatePostInput): Promise<UpdatePostResponse> =>
      updatePostFn({
        data: {
          id: postId,
          title,
          content,
          contentJson: contentJson as { type: 'doc'; content?: unknown[] },
        },
      }) as Promise<UpdatePostResponse>,
    onMutate: async ({ postId, title, content, contentJson, statusId }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(inboxKeys.detail(postId))
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), {
          ...previousDetail,
          title,
          content,
          contentJson,
          statusId: statusId ?? previousDetail.statusId,
        })
      }
      updatePostInLists(queryClient, postId, (post) => ({
        ...post,
        title,
        content,
        statusId: statusId ?? post.statusId,
      }))

      return { previousDetail, previousLists }
    },
    onError: (_err, { postId }, context) => {
      rollbackDetailAndLists(queryClient, postId, context)
    },
    onSuccess: (data, { postId }) => {
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), (old) =>
        old
          ? {
              ...old,
              title: data.title,
              content: data.content,
              contentJson: data.contentJson,
              statusId: data.statusId,
            }
          : old
      )
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId) })
    },
  })
}

// ============================================================================
// Vote Post Mutation (for admin inbox)
// ============================================================================

export function useVotePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (postId: PostId): Promise<VotePostResponse> => toggleVoteFn({ data: { postId } }),
    onMutate: async (postId) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(inboxKeys.detail(postId))
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      const wasVoted = previousDetail?.hasVoted ?? false
      const voteDelta = wasVoted ? -1 : 1

      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), {
          ...previousDetail,
          hasVoted: !wasVoted,
          voteCount: previousDetail.voteCount + voteDelta,
        })
      }
      updatePostInLists(queryClient, postId, (post) => ({
        ...post,
        voteCount: post.voteCount + voteDelta,
      }))

      return { previousDetail, previousLists }
    },
    onError: (_err, postId, context) => {
      rollbackDetailAndLists(queryClient, postId, context)
    },
    onSuccess: (data, postId) => {
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), (old) =>
        old ? { ...old, voteCount: data.voteCount, hasVoted: data.voted } : old
      )
      updatePostInLists(queryClient, postId, (post) => ({ ...post, voteCount: data.voteCount }))
    },
  })
}

// ============================================================================
// Add Comment Mutation
// ============================================================================

export function useAddComment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ postId, content, parentId }: AddCommentInput) =>
      createCommentFn({
        data: {
          postId: postId as PostId,
          content: content.trim(),
          parentId: (parentId || undefined) as CommentId | undefined,
        },
      }),
    onMutate: async ({ postId, content, parentId, authorName, authorEmail, memberId }) => {
      const typedPostId = postId as PostId
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(typedPostId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(inboxKeys.detail(typedPostId))
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      const optimisticComment: CommentWithReplies = {
        id: `comment_temp${Date.now()}` as CommentId,
        postId: typedPostId,
        content,
        authorId: null,
        authorName: authorName || null,
        authorEmail: authorEmail || null,
        memberId: (memberId || null) as MemberId | null,
        parentId: (parentId || null) as CommentId | null,
        isTeamMember: !!memberId,
        createdAt: new Date(),
        replies: [],
        reactions: [],
      }

      if (previousDetail) {
        const updatedComments = parentId
          ? addReplyToComment(previousDetail.comments, parentId as CommentId, optimisticComment)
          : [...previousDetail.comments, optimisticComment]
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(typedPostId), {
          ...previousDetail,
          comments: updatedComments,
        })
      }
      updatePostInLists(queryClient, typedPostId, (post) => ({
        ...post,
        commentCount: post.commentCount + 1,
      }))

      return { previousDetail, previousLists }
    },
    onError: (_err, { postId }, context) => {
      rollbackDetailAndLists(queryClient, postId as PostId, context)
    },
    onSuccess: (data, { postId, content, parentId }) => {
      const typedPostId = postId as PostId
      const serverComment = data as { comment: { id: CommentId; createdAt: Date } }

      queryClient.setQueryData<PostDetails>(inboxKeys.detail(typedPostId), (old) => {
        if (!old) return old
        return {
          ...old,
          comments: replaceOptimisticComment(
            old.comments,
            parentId ?? null,
            content,
            serverComment.comment
          ),
        }
      })
    },
  })
}

/** Replace optimistic comment with real server data */
function replaceOptimisticComment(
  comments: CommentWithReplies[],
  parentId: string | null,
  content: string,
  serverComment: { id: CommentId; createdAt: Date }
): CommentWithReplies[] {
  return comments.map((comment) => {
    if (comment.id.startsWith('comment_temp')) {
      const sameParent = (comment.parentId || null) === (parentId || null)
      const sameContent = comment.content === content
      if (sameParent && sameContent) {
        return { ...comment, id: serverComment.id, createdAt: serverComment.createdAt }
      }
    }
    if (comment.replies.length > 0) {
      return {
        ...comment,
        replies: replaceOptimisticComment(comment.replies, parentId, content, serverComment),
      }
    }
    return comment
  })
}

// ============================================================================
// Create Post Mutation (for admin create dialog)
// ============================================================================

export function useCreatePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreatePostInput) =>
      createPostFn({
        data: {
          title: input.title,
          content: input.content,
          contentJson: input.contentJson as { type: 'doc'; content?: unknown[] },
          boardId: input.boardId,
          statusId: input.statusId,
          tagIds: input.tagIds,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
    },
  })
}

// Helper to add a reply to a nested comment structure
function addReplyToComment(
  comments: CommentWithReplies[],
  parentId: CommentId,
  newComment: CommentWithReplies
): CommentWithReplies[] {
  return comments.map((comment) => {
    if (comment.id === parentId) {
      return {
        ...comment,
        replies: [...comment.replies, newComment],
      }
    }
    if (comment.replies.length > 0) {
      return {
        ...comment,
        replies: addReplyToComment(comment.replies, parentId, newComment),
      }
    }
    return comment
  })
}
