'use client'

import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type { InboxFilters } from '@/app/s/[orgSlug]/admin/feedback/use-inbox-filters'
import type {
  PostDetails,
  CommentReaction,
  CommentWithReplies,
} from '@/app/s/[orgSlug]/admin/feedback/inbox-types'
import type { PostListItem, PostStatus, InboxPostListResult, Tag } from '@quackback/db/types'

// ============================================================================
// Query Key Factory
// ============================================================================

export const inboxKeys = {
  all: ['inbox'] as const,
  lists: () => [...inboxKeys.all, 'list'] as const,
  list: (organizationId: string, filters: InboxFilters) =>
    [...inboxKeys.lists(), organizationId, filters] as const,
  details: () => [...inboxKeys.all, 'detail'] as const,
  detail: (postId: string, organizationId: string) =>
    [...inboxKeys.details(), postId, organizationId] as const,
}

// ============================================================================
// Fetch Functions
// ============================================================================

async function fetchInboxPosts(
  organizationId: string,
  filters: InboxFilters,
  page: number
): Promise<InboxPostListResult> {
  const params = new URLSearchParams()
  params.set('organizationId', organizationId)
  params.set('page', page.toString())

  if (filters.search) params.set('search', filters.search)
  if (filters.sort) params.set('sort', filters.sort)
  filters.status?.forEach((s) => params.append('status', s))
  filters.board?.forEach((b) => params.append('board', b))
  filters.tags?.forEach((t) => params.append('tags', t))
  if (filters.owner) params.set('owner', filters.owner)
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.minVotes !== undefined) params.set('minVotes', filters.minVotes.toString())

  const response = await fetch(`/api/posts?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch posts')
  return response.json()
}

async function fetchPostDetail(postId: string, organizationId: string): Promise<PostDetails> {
  const response = await fetch(`/api/posts/${postId}?organizationId=${organizationId}`)
  if (!response.ok) throw new Error('Failed to fetch post')
  return response.json()
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseInboxPostsOptions {
  organizationId: string
  filters: InboxFilters
  initialData?: InboxPostListResult
}

export function useInboxPosts({ organizationId, filters, initialData }: UseInboxPostsOptions) {
  return useInfiniteQuery({
    queryKey: inboxKeys.list(organizationId, filters),
    queryFn: ({ pageParam }) => fetchInboxPosts(organizationId, filters, pageParam),
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
  postId: string | null
  organizationId: string
  enabled?: boolean
}

export function usePostDetail({ postId, organizationId, enabled = true }: UsePostDetailOptions) {
  return useQuery({
    queryKey: inboxKeys.detail(postId!, organizationId),
    queryFn: () => fetchPostDetail(postId!, organizationId),
    enabled: enabled && !!postId,
    staleTime: 30 * 1000,
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

export function useUpdatePostStatus(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId, status }: { postId: string; status: PostStatus }) => {
      const response = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, organizationId }),
      })
      if (!response.ok) throw new Error('Failed to update status')
      return response.json()
    },
    onMutate: async ({ postId, status }) => {
      // Cancel outgoing refetches for all inbox queries
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      // Snapshot previous detail
      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, organizationId)
      )

      // Snapshot ALL list queries (regardless of filters)
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      // Optimistically update detail
      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, organizationId), {
          ...previousDetail,
          status,
        })
      }

      // Optimistically update ALL list queries using predicate matching
      queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
        { queryKey: inboxKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((post) => (post.id === postId ? { ...post, status } : post)),
            })),
          }
        }
      )

      return { previousDetail, previousLists }
    },
    onError: (_err, { postId }, context) => {
      // Rollback detail on error
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, organizationId), context.previousDetail)
      }
      // Rollback all list queries
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSettled: (_data, _error, { postId }) => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
    },
  })
}

export function useUpdatePostOwner(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId, ownerId }: { postId: string; ownerId: string | null }) => {
      const response = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, organizationId }),
      })
      if (!response.ok) throw new Error('Failed to update owner')
      return response.json()
    },
    onMutate: async ({ postId, ownerId }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, organizationId)
      )

      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      // Optimistically update detail
      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, organizationId), {
          ...previousDetail,
          ownerId,
        })
      }

      // Optimistically update ALL list queries
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
        queryClient.setQueryData(inboxKeys.detail(postId, organizationId), context.previousDetail)
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
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
    },
  })
}

interface UpdateTagsInput {
  postId: string
  tagIds: string[]
  allTags: Tag[]
}

export function useUpdatePostTags(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId, tagIds }: UpdateTagsInput) => {
      const response = await fetch(`/api/posts/${postId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds, organizationId }),
      })
      if (!response.ok) throw new Error('Failed to update tags')
      return response.json()
    },
    onMutate: async ({ postId, tagIds, allTags }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, organizationId)
      )

      // Snapshot ALL list queries (regardless of filters)
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      // Build mapped tags for optimistic update
      const tagIdSet = new Set(tagIds)
      const mappedTags = allTags
        .filter((t) => tagIdSet.has(t.id))
        .map((t) => ({ id: t.id, name: t.name, color: t.color }))

      // Update detail
      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, organizationId), {
          ...previousDetail,
          tags: mappedTags,
        })
      }

      // Optimistically update ALL list queries using predicate matching
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
      // Rollback detail on error
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, organizationId), context.previousDetail)
      }
      // Rollback all list queries
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
    },
  })
}

export function useUpdateOfficialResponse(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId, response }: { postId: string; response: string | null }) => {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officialResponse: response, organizationId }),
      })
      if (!res.ok) throw new Error('Failed to update official response')
      return res.json()
    },
    onSuccess: (data, { postId }) => {
      // Update detail cache with server response (includes author name, timestamp)
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, organizationId), (old) => {
        if (!old) return old
        return {
          ...old,
          officialResponse: data.officialResponse
            ? {
                content: data.officialResponse,
                authorName: data.officialResponseAuthorName,
                respondedAt: data.officialResponseAt,
              }
            : null,
        }
      })
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
    },
  })
}

// ============================================================================
// Comment Reaction Mutation
// ============================================================================

interface ToggleReactionInput {
  postId: string
  commentId: string
  emoji: string
}

interface ToggleReactionResponse {
  reactions: CommentReaction[]
}

export function useToggleCommentReaction(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      commentId,
      emoji,
    }: ToggleReactionInput): Promise<ToggleReactionResponse> => {
      const response = await fetch(`/api/public/comments/${commentId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      })
      if (!response.ok) throw new Error('Failed to toggle reaction')
      return response.json()
    },
    onMutate: async ({ postId, commentId, emoji }) => {
      // Cancel any outgoing refetches for post detail
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, organizationId) })

      // Snapshot the previous value
      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, organizationId)
      )

      // Optimistically update the post detail cache
      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, organizationId), {
          ...previousDetail,
          comments: updateCommentsReaction(previousDetail.comments, commentId, emoji),
        })
      }

      return { previousDetail }
    },
    onError: (_err, { postId }, context) => {
      // Rollback on error
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, organizationId), context.previousDetail)
      }
    },
    onSuccess: (data, { postId, commentId }) => {
      // Update with server response for accurate counts
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, organizationId), (old) => {
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
  commentId: string,
  emoji: string
): CommentWithReplies[] {
  return comments.map((comment) => {
    if (comment.id === commentId) {
      const existingReaction = comment.reactions?.find((r) => r.emoji === emoji)
      let newReactions: CommentReaction[]

      if (existingReaction?.hasReacted) {
        // Remove reaction (decrement count or remove entirely)
        newReactions = comment.reactions
          .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, hasReacted: false } : r))
          .filter((r) => r.count > 0)
      } else if (existingReaction) {
        // Add reaction to existing emoji
        newReactions = comment.reactions.map((r) =>
          r.emoji === emoji ? { ...r, count: r.count + 1, hasReacted: true } : r
        )
      } else {
        // Add new emoji reaction
        newReactions = [...(comment.reactions || []), { emoji, count: 1, hasReacted: true }]
      }

      return { ...comment, reactions: newReactions }
    }

    // Recursively update nested replies
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
  commentId: string,
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
  postId: string
  title: string
  content: string
  contentJson: unknown
  status: PostStatus
  boardId?: string
  tagIds?: string[]
  allTags?: Tag[]
}

interface UpdatePostResponse {
  id: string
  title: string
  content: string
  contentJson: unknown
  status: PostStatus
  boardId: string
}

export function useUpdatePost(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      postId,
      title,
      content,
      contentJson,
      status,
    }: UpdatePostInput): Promise<UpdatePostResponse> => {
      const response = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, contentJson, status, organizationId }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update post')
      }
      return response.json()
    },
    onMutate: async ({ postId, title, content, contentJson, status }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      // Snapshot previous state
      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, organizationId)
      )
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      // Optimistically update detail
      if (previousDetail) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, organizationId), {
          ...previousDetail,
          title,
          content,
          contentJson,
          status,
        })
      }

      // Optimistically update ALL list queries
      queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
        { queryKey: inboxKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((post) =>
                post.id === postId ? { ...post, title, content, status } : post
              ),
            })),
          }
        }
      )

      return { previousDetail, previousLists }
    },
    onError: (_err, { postId }, context) => {
      // Rollback on error
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, organizationId), context.previousDetail)
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
      // Update with server response for accuracy
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, organizationId), (old) => {
        if (!old) return old
        return {
          ...old,
          title: data.title,
          content: data.content,
          contentJson: data.contentJson,
          status: data.status,
        }
      })
    },
    onSettled: (_data, _error, { postId }) => {
      // Ensure consistency
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
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

export function useVotePost(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: string): Promise<VotePostResponse> => {
      const response = await fetch(`/api/public/posts/${postId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error('Failed to vote')
      return response.json()
    },
    onMutate: async (postId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      // Snapshot previous state
      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, organizationId)
      )
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      // Optimistically update detail
      if (previousDetail) {
        const newHasVoted = !previousDetail.hasVoted
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, organizationId), {
          ...previousDetail,
          hasVoted: newHasVoted,
          voteCount: newHasVoted ? previousDetail.voteCount + 1 : previousDetail.voteCount - 1,
        })
      }

      // Optimistically update ALL list queries
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
      // Rollback on error
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, organizationId), context.previousDetail)
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
      // Update with server response for accuracy
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, organizationId), (old) => {
        if (!old) return old
        return {
          ...old,
          voteCount: data.voteCount,
          hasVoted: data.voted,
        }
      })

      // Update list caches with accurate vote count
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
  postId: string
  content: string
  parentId?: string | null
  authorName?: string | null
  authorEmail?: string | null
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

export function useAddComment(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      postId,
      content,
      parentId,
      authorName,
      authorEmail,
    }: AddCommentInput): Promise<AddCommentResponse> => {
      const response = await fetch(`/api/public/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          authorName: authorName?.trim() || null,
          authorEmail: authorEmail?.trim() || null,
          parentId: parentId || null,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to post comment')
      }
      return response.json()
    },
    onMutate: async ({ postId, content, parentId, authorName }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
      await queryClient.cancelQueries({ queryKey: inboxKeys.lists() })

      // Snapshot previous state
      const previousDetail = queryClient.getQueryData<PostDetails>(
        inboxKeys.detail(postId, organizationId)
      )
      const previousLists = queryClient.getQueriesData<InfiniteData<InboxPostListResult>>({
        queryKey: inboxKeys.lists(),
      })

      // Create optimistic comment
      const optimisticComment: CommentWithReplies = {
        id: `temp-${Date.now()}`,
        postId,
        content,
        authorId: null, // Will be populated by server
        authorName: authorName || null,
        authorEmail: null,
        memberId: null,
        parentId: parentId || null,
        isTeamMember: true, // Admin users are team members
        createdAt: new Date(),
        replies: [],
        reactions: [],
      }

      // Optimistically update detail cache
      if (previousDetail) {
        const updatedComments = parentId
          ? addReplyToComment(previousDetail.comments, parentId, optimisticComment)
          : [...previousDetail.comments, optimisticComment]

        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId, organizationId), {
          ...previousDetail,
          comments: updatedComments,
        })
      }

      // Optimistically update comment count in list caches
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
      // Rollback on error
      if (context?.previousDetail) {
        queryClient.setQueryData(inboxKeys.detail(postId, organizationId), context.previousDetail)
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
      // Refetch to get accurate data with proper IDs
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId, organizationId) })
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
  boardId: string
  status: PostStatus
  tagIds: string[]
}

interface CreatePostResponse {
  id: string
  title: string
  content: string
  contentJson: unknown
  status: PostStatus
  boardId: string
}

export function useCreatePost(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreatePostInput): Promise<CreatePostResponse> => {
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, organizationId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create post')
      }

      return response.json()
    },
    onSuccess: () => {
      // Invalidate all inbox lists to show the new post
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
    },
  })
}

// Helper to add a reply to a nested comment structure
function addReplyToComment(
  comments: CommentWithReplies[],
  parentId: string,
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
