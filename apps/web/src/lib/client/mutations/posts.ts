/**
 * Post mutations for admin inbox
 *
 * Mutation hooks for post CRUD and status/tag operations.
 */

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import {
  changePostStatusFn,
  changePostBoardFn,
  updatePostFn,
  updatePostTagsFn,
  createPostFn,
  toggleCommentsLockFn,
  deletePostFn,
  restorePostFn,
  proxyVoteFn,
  removeVoteFn,
} from '@/lib/server/functions/posts'
import { toggleVoteFn } from '@/lib/server/functions/public-posts'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import { roadmapPostsKeys } from '@/lib/client/hooks/use-roadmap-posts-query'
import type { PostDetails } from '@/lib/shared/types'
import type { PostListItem, InboxPostListResult, Tag } from '@/lib/shared/db-types'
import type { PrincipalId, PostId, StatusId, TagId, BoardId } from '@featurepool/ids'
import type { CreatePostInput } from '@/lib/server/domains/posts'

// ============================================================================
// Types
// ============================================================================

interface UpdateTagsInput {
  postId: PostId
  tagIds: string[]
  allTags: Tag[]
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
// Status Mutations
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

// ============================================================================
// Board Mutations
// ============================================================================

export function useChangePostBoard() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ postId, boardId }: { postId: PostId; boardId: BoardId }) =>
      changePostBoardFn({ data: { id: postId, boardId } }),
    onSuccess: (_data, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId) })
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
    },
  })
}

// ============================================================================
// Owner Mutations
// ============================================================================

export function useUpdatePostOwner() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ postId, ownerId }: { postId: PostId; ownerId: PrincipalId | null }) =>
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
          ownerPrincipalId: ownerId,
        })
      }
      updatePostInLists(queryClient, postId, (post) => ({ ...post, ownerPrincipalId: ownerId }))

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
// Tag Mutations
// ============================================================================

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
// Create Post Mutation (for admin create dialog)
// ============================================================================

export function useCreatePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreatePostInput & { authorPrincipalId?: string }) =>
      createPostFn({
        data: {
          title: input.title,
          content: input.content,
          contentJson: input.contentJson as { type: 'doc'; content?: unknown[] },
          boardId: input.boardId,
          statusId: input.statusId,
          tagIds: input.tagIds,
          authorPrincipalId: input.authorPrincipalId,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
      queryClient.invalidateQueries({ queryKey: roadmapPostsKeys.all })
    },
  })
}

// ============================================================================
// Proxy Vote Mutation (admin votes on behalf of a user)
// ============================================================================

export function useProxyVote(postId: PostId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (voterPrincipalId: PrincipalId) =>
      proxyVoteFn({ data: { postId, voterPrincipalId } }),
    onSuccess: (data) => {
      // Update detail cache vote count
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), (old) =>
        old ? { ...old, voteCount: data.voteCount } : old
      )
      // Update list caches
      updatePostInLists(queryClient, postId, (post) => ({
        ...post,
        voteCount: data.voteCount,
      }))
      // Refresh avatar stack
      queryClient.invalidateQueries({ queryKey: ['inbox', 'voters', postId] })
    },
  })
}

// ============================================================================
// Remove Vote Mutation (admin removes any user's vote)
// ============================================================================

export function useRemoveVote(postId: PostId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (voterPrincipalId: PrincipalId) =>
      removeVoteFn({ data: { postId, voterPrincipalId } }),
    onSuccess: (data) => {
      queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), (old) =>
        old ? { ...old, voteCount: data.voteCount } : old
      )
      updatePostInLists(queryClient, postId, (post) => ({
        ...post,
        voteCount: data.voteCount,
      }))
      queryClient.invalidateQueries({ queryKey: ['inbox', 'voters', postId] })
    },
  })
}

// ============================================================================
// Delete Post Mutation (admin soft delete)
// ============================================================================

interface DeletePostInput {
  postId: PostId
  cascadeChoices?: Array<{
    linkId: string
    shouldArchive: boolean
  }>
}

export interface DeletePostResult {
  id: string
  cascadeResults?: Array<{
    linkId: string
    integrationType: string
    externalId: string
    success: boolean
    error?: string
  }>
}

export function useDeletePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ postId, cascadeChoices }: DeletePostInput): Promise<DeletePostResult> =>
      deletePostFn({ data: { id: postId, cascadeChoices } }),
    onSuccess: (_data, { postId }) => {
      // Remove from all list caches
      queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
        { queryKey: inboxKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter((post) => post.id !== postId),
            })),
          }
        }
      )
      // Remove detail cache
      queryClient.removeQueries({ queryKey: inboxKeys.detail(postId) })
      // Invalidate lists and roadmap
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
      queryClient.invalidateQueries({ queryKey: roadmapPostsKeys.all })
    },
  })
}

// ============================================================================
// Restore Post Mutation (admin restore soft-deleted)
// ============================================================================

export function useRestorePost() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (postId: PostId) => restorePostFn({ data: { id: postId } }),
    onSuccess: (_data, postId) => {
      // Remove from current (deleted) list cache
      queryClient.setQueriesData<InfiniteData<InboxPostListResult>>(
        { queryKey: inboxKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter((post) => post.id !== postId),
            })),
          }
        }
      )
      // Remove detail cache
      queryClient.removeQueries({ queryKey: inboxKeys.detail(postId) })
      // Invalidate all lists and roadmap (restored posts may reappear in roadmaps)
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
      queryClient.invalidateQueries({ queryKey: roadmapPostsKeys.all })
    },
  })
}

// ============================================================================
// Toggle Comments Lock Mutation
// ============================================================================

export function useToggleCommentsLock() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ postId, locked }: { postId: PostId; locked: boolean }) =>
      toggleCommentsLockFn({ data: { id: postId, locked } }),
    onMutate: async ({ postId, locked }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.detail(postId) })
      const previous = queryClient.getQueryData<PostDetails>(inboxKeys.detail(postId))
      if (previous) {
        queryClient.setQueryData<PostDetails>(inboxKeys.detail(postId), {
          ...previous,
          isCommentsLocked: locked,
        })
      }
      return { previous }
    },
    onError: (_err, { postId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(inboxKeys.detail(postId), context.previous)
      }
    },
    onSettled: (_data, _error, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId) })
    },
  })
}
