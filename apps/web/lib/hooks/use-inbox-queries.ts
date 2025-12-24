'use client'

import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import {
  listInboxPostsAction,
  getPostWithDetailsAction,
  changePostStatusAction,
  updatePostAction,
  updatePostTagsAction,
  createPostAction,
} from '@/lib/actions/posts'
import { toggleVoteAction, createCommentAction, toggleReactionAction } from '@/lib/actions'
import type { InboxFilters } from '@/app/admin/feedback/use-inbox-filters'
import type {
  PostDetails,
  CommentReaction,
  CommentWithReplies,
} from '@/app/admin/feedback/inbox-types'
import type { PostListItem, InboxPostListResult, Tag } from '@/lib/db'
import type {
  BoardId,
  CommentId,
  MemberId,
  PostId,
  StatusId,
  TagId,
  WorkspaceId,
} from '@quackback/ids'

// ============================================================================
// Query Key Factory
// ============================================================================

export const inboxKeys = {
  all: ['inbox'] as const,
  lists: () => [...inboxKeys.all, 'list'] as const,
  list: (workspaceId: WorkspaceId, filters: InboxFilters) =>
    [...inboxKeys.lists(), workspaceId, filters] as const,
  details: () => [...inboxKeys.all, 'detail'] as const,
  detail: (postId: PostId, workspaceId: WorkspaceId) =>
    [...inboxKeys.details(), postId, workspaceId] as const,
}

// ============================================================================
// Fetch Functions (using server actions)
// ============================================================================

async function fetchInboxPosts(
  workspaceId: WorkspaceId,
  filters: InboxFilters,
  page: number
): Promise<InboxPostListResult> {
  const result = await listInboxPostsAction({
    boardIds: filters.board as BoardId[] | undefined,
    statusIds: filters.status as StatusId[] | undefined,
    tagIds: filters.tags as TagId[] | undefined,
    ownerId: (filters.owner || undefined) as MemberId | null | undefined,
    search: filters.search,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    minVotes: filters.minVotes,
    sort: filters.sort || 'newest',
    page,
    limit: 20,
  })

  if (!result.success) {
    throw new Error(result.error.message)
  }

  return result.data as InboxPostListResult
}

async function fetchPostDetail(postId: PostId): Promise<PostDetails> {
  const result = await getPostWithDetailsAction({
    id: postId,
  })

  if (!result.success) {
    throw new Error(result.error.message)
  }

  // Cast the result data to PostDetails - the types are compatible
  return result.data as unknown as PostDetails
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseInboxPostsOptions {
  workspaceId: WorkspaceId
  filters: InboxFilters
  initialData?: InboxPostListResult
}

export function useInboxPosts({ workspaceId, filters, initialData }: UseInboxPostsOptions) {
  return useInfiniteQuery({
    queryKey: inboxKeys.list(workspaceId, filters),
    queryFn: ({ pageParam }) => fetchInboxPosts(workspaceId, filters, pageParam),
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

// Helper to flatten paginated posts into a single array
export function flattenInboxPosts(
  data: InfiniteData<InboxPostListResult> | undefined
): PostListItem[] {
  if (!data) return []
  return data.pages.flatMap((page) => page.items)
}

interface UsePostDetailOptions {
  postId: PostId | null
  workspaceId: WorkspaceId
  enabled?: boolean
}

export function usePostDetail({ postId, workspaceId, enabled = true }: UsePostDetailOptions) {
  return useQuery({
    queryKey: inboxKeys.detail(postId!, workspaceId),
    queryFn: () => fetchPostDetail(postId!),
    enabled: enabled && !!postId,
    staleTime: 30 * 1000,
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * @deprecated Use useChangePostStatusId instead - the legacy status field has been removed
 */
export function useUpdatePostStatus(workspaceId: WorkspaceId) {
  const changeStatusId = useChangePostStatusId(workspaceId)
  return changeStatusId
}

/**
 * Hook to change a post's status using TypeID-based statusId
 */
export function useChangePostStatusId(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId, statusId }: { postId: PostId; statusId: StatusId }) => {
      const result = await changePostStatusAction({
        id: postId,
        statusId,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onSuccess: (_data, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ['roadmapPosts'] })
    },
  })
}

export function useUpdatePostOwner(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId, ownerId }: { postId: PostId; ownerId: MemberId | null }) => {
      const result = await updatePostAction({
        id: postId,
        ownerId,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onMutate: async ({ postId, ownerId }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, workspaceId)
      )

      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, workspaceId), {
          ...previousDetail,
          ownerId,
        })
      }

      queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
        { queryKey: inboxKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((post) => (post.id === postId ? { ...post, ownerId } : post)),
            })),
          }
        }
      )

      return { previousDetail, previousLists }
    },
    onError: (_err, { postId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, workspaceId), context.previousDetail)
      }
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })
    },
  })
}

interface UpdateTagsInput {
  postId: PostId
  tagIds: string[]
  allTags: Tag[]
}

export function useUpdatePostTags(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId, tagIds }: UpdateTagsInput) => {
      const result = await updatePostTagsAction({
        id: postId,
        tagIds,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onMutate: async ({ postId, tagIds, allTags }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, workspaceId)
      )

      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      const tagIdSet = new Set(tagIds)
      const mappedTags = allTags
        .filter((t) => tagIdSet.has(t.id))
        .map((t) => ({ id: t.id, name: t.name, color: t.color }))

      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, workspaceId), {
          ...previousDetail,
          tags: mappedTags,
        })
      }

      queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
        { queryKey: inboxKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((post) =>
                post.id === postId ? { ...post, tags: mappedTags } : post
              ),
            })),
          }
        }
      )

      return { previousDetail, previousLists }
    },
    onError: (_err, { postId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, workspaceId), context.previousDetail)
      }
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })
    },
  })
}

export function useUpdateOfficialResponse(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId, response }: { postId: PostId; response: string | null }) => {
      const result = await updatePostAction({
        id: postId,
        officialResponse: response,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onSuccess: (data, { postId }) => {
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, workspaceId), (old) => {
        if (!old) return old
        const typedData = data as {
          officialResponse?: string | null
          officialResponseAuthorName?: string | null
          officialResponseAt?: string | null
        }
        return {
          ...old,
          officialResponse: typedData.officialResponse
            ? {
                content: typedData.officialResponse,
                authorName: typedData.officialResponseAuthorName ?? null,
                respondedAt: typedData.officialResponseAt
                  ? new Date(typedData.officialResponseAt)
                  : new Date(),
              }
            : null,
        }
      })
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })
    },
  })
}

// ============================================================================
// Comment Reaction Mutation
// ============================================================================

interface ToggleReactionInput {
  postId: PostId
  commentId: CommentId
  emoji: string
}

interface ToggleReactionResponse {
  reactions: CommentReaction[]
}

export function useToggleCommentReaction(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      commentId,
      emoji,
    }: ToggleReactionInput): Promise<ToggleReactionResponse> => {
      const result = await toggleReactionAction({ commentId, emoji })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      // The action returns { added, reactions } from the domain service
      // reactions already has { emoji, count, hasReacted } for each reaction
      return { reactions: result.data.reactions }
    },
    onMutate: async ({ postId, commentId, emoji }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })

      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, workspaceId)
      )

      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, workspaceId), {
          ...previousDetail,
          comments: updateCommentsReaction(previousDetail.comments, commentId, emoji),
        })
      }

      return { previousDetail }
    },
    onError: (_err, { postId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, workspaceId), context.previousDetail)
      }
    },
    onSuccess: (data, { postId, commentId }) => {
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, workspaceId), (old) => {
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

export function useUpdatePost(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      postId,
      title,
      content,
      contentJson,
    }: UpdatePostInput): Promise<UpdatePostResponse> => {
      const result = await updatePostAction({
        id: postId,
        title,
        content,
        contentJson: contentJson as { type: 'doc'; content?: unknown[] },
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data as UpdatePostResponse
    },
    onMutate: async ({ postId, title, content, contentJson, statusId }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, workspaceId)
      )
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, workspaceId), {
          ...previousDetail,
          title,
          content,
          contentJson,
          statusId: statusId ?? previousDetail.statusId,
        })
      }

      queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
        { queryKey: inboxKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((post) =>
                post.id === postId
                  ? { ...post, title, content, statusId: statusId ?? post.statusId }
                  : post
              ),
            })),
          }
        }
      )

      return { previousDetail, previousLists }
    },
    onError: (_err, { postId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, workspaceId), context.previousDetail)
      }
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSuccess: (data, { postId }) => {
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, workspaceId), (old) => {
        if (!old) return old
        return {
          ...old,
          title: data.title,
          content: data.content,
          contentJson: data.contentJson,
          statusId: data.statusId,
        }
      })
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })
    },
  })
}

// ============================================================================
// Vote Post Mutation (for admin inbox)
// ============================================================================

interface VotePostResponse {
  voteCount: number
  voted: boolean
}

export function useVotePost(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: PostId): Promise<VotePostResponse> => {
      const result = await toggleVoteAction({ postId })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    onMutate: async (postId) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, workspaceId)
      )
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      if (previousDetail) {
        const newHasVoted = !previousDetail.hasVoted
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, workspaceId), {
          ...previousDetail,
          hasVoted: newHasVoted,
          voteCount: newHasVoted ? previousDetail.voteCount + 1 : previousDetail.voteCount - 1,
        })
      }

      queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
        { queryKey: inboxKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((post) => {
                if (post.id !== postId) return post
                return {
                  ...post,
                  voteCount: post.voteCount + (previousDetail?.hasVoted ? -1 : 1),
                }
              }),
            })),
          }
        }
      )

      return { previousDetail, previousLists }
    },
    onError: (_err, postId, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, workspaceId), context.previousDetail)
      }
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSuccess: (data, postId) => {
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, workspaceId), (old) => {
        if (!old) return old
        return {
          ...old,
          voteCount: data.voteCount,
          hasVoted: data.voted,
        }
      })

      queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
        { queryKey: inboxKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((post) =>
                post.id === postId ? { ...post, voteCount: data.voteCount } : post
              ),
            })),
          }
        }
      )
    },
  })
}

// ============================================================================
// Add Comment Mutation
// ============================================================================

interface AddCommentInput {
  postId: PostId
  content: string
  parentId?: CommentId | null
  authorName?: string | null
  authorEmail?: string | null
  memberId?: MemberId | null
}

interface AddCommentResponse {
  id: string
  postId: string
  content: string
  authorName: string | null
  authorEmail: string | null
  memberId: string | null
  parentId: string | null
  isTeamMember: boolean
  createdAt: string
}

export function useAddComment(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      postId,
      content,
      parentId,
    }: AddCommentInput): Promise<AddCommentResponse> => {
      const result = await createCommentAction({
        postId,
        content: content.trim(),
        parentId: parentId || null,
      })
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data as AddCommentResponse
    },
    onMutate: async ({ postId, content, parentId, authorName, authorEmail, memberId }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, workspaceId)
      )
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      const optimisticComment: CommentWithReplies = {
        id: `comment_temp${Date.now()}` as CommentId,
        postId: postId as PostId,
        content,
        authorId: null,
        authorName: authorName || null,
        authorEmail: authorEmail || null,
        memberId: (memberId || null) as MemberId | null,
        parentId: (parentId || null) as CommentId | null,
        isTeamMember: !!memberId, // Team member if they have a memberId
        createdAt: new Date(),
        deletedAt: null,
        replies: [],
        reactions: [],
      }

      if (previousDetail) {
        const updatedComments = parentId
          ? addReplyToComment(previousDetail.comments, parentId, optimisticComment)
          : [...previousDetail.comments, optimisticComment]

        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, workspaceId), {
          ...previousDetail,
          comments: updatedComments,
        })
      }

      queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
        { queryKey: inboxKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((post) =>
                post.id === postId ? { ...post, commentCount: post.commentCount + 1 } : post
              ),
            })),
          }
        }
      )

      return { previousDetail, previousLists }
    },
    onError: (_err, { postId }, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, workspaceId), context.previousDetail)
      }
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, workspaceId) })
    },
  })
}

// ============================================================================
// Create Post Mutation (for admin create dialog)
// ============================================================================

interface CreatePostInput {
  title: string
  content: string
  contentJson?: unknown
  boardId: BoardId
  statusId?: StatusId
  tagIds: TagId[]
}

interface CreatePostResponse {
  id: string
  title: string
  content: string
  contentJson: unknown
  statusId: StatusId | null
  boardId: string
}

export function useCreatePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreatePostInput): Promise<CreatePostResponse> => {
      const result = await createPostAction({
        title: input.title,
        content: input.content,
        contentJson: input.contentJson as { type: 'doc'; content?: unknown[] },
        boardId: input.boardId as BoardId,
        statusId: input.statusId,
        tagIds: input.tagIds as TagId[],
      })

      if (!result.success) {
        throw new Error(result.error.message)
      }

      return result.data as CreatePostResponse
    },
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
