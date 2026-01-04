import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type { RoadmapPost, RoadmapPostListResult } from '@/lib/posts'
import type { RoadmapPostsListResult, RoadmapPostEntry } from '@/lib/roadmaps'
import type { RoadmapId, StatusId, PostId } from '@quackback/ids'
import {
  getRoadmapPostsFn,
  addPostToRoadmapFn,
  removePostFromRoadmapFn,
} from '@/lib/server-functions/roadmaps'
import { getRoadmapPostsByStatusFn } from '@/lib/server-functions/public-posts'

export const roadmapPostsKeys = {
  all: ['roadmapPosts'] as const,
  lists: () => [...roadmapPostsKeys.all, 'list'] as const,
  list: (statusId: StatusId) => [...roadmapPostsKeys.lists(), statusId] as const,
  byRoadmap: (roadmapId: RoadmapId, statusId?: StatusId) =>
    [...roadmapPostsKeys.all, 'roadmap', roadmapId, statusId ?? 'all'] as const,
}

interface UseRoadmapPostsOptions {
  statusId: StatusId
  initialData?: RoadmapPostListResult
}

export function useRoadmapPosts({ statusId, initialData }: UseRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.list(statusId),
    queryFn: ({ pageParam }): Promise<RoadmapPostListResult> =>
      getRoadmapPostsByStatusFn({
        data: {
          statusId,
          page: pageParam,
          limit: 10,
        },
      }) as Promise<RoadmapPostListResult>,
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

interface UseRoadmapPostsByRoadmapOptions {
  roadmapId: RoadmapId
  statusId?: StatusId
  enabled?: boolean
}

export function useRoadmapPostsByRoadmap({
  roadmapId,
  statusId,
  enabled = true,
}: UseRoadmapPostsByRoadmapOptions) {
  return useInfiniteQuery({
    queryKey: roadmapPostsKeys.byRoadmap(roadmapId, statusId),
    queryFn: async ({ pageParam }): Promise<RoadmapPostsListResult> => {
      return (await getRoadmapPostsFn({
        data: {
          roadmapId,
          statusId,
          limit: 20,
          offset: pageParam,
        },
      })) as RoadmapPostsListResult
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * 20 : undefined),
    enabled,
  })
}

export function useAddPostToRoadmap(roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: PostId): Promise<void> => {
      await addPostToRoadmapFn({
        data: {
          roadmapId,
          postId,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...roadmapPostsKeys.all, 'roadmap', roadmapId],
      })
    },
  })
}

export function useRemovePostFromRoadmap(roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (postId: PostId): Promise<void> => {
      await removePostFromRoadmapFn({
        data: {
          roadmapId,
          postId,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...roadmapPostsKeys.all, 'roadmap', roadmapId],
      })
    },
  })
}

interface UsePublicRoadmapPostsOptions {
  roadmapId: RoadmapId
  statusId?: StatusId
  enabled?: boolean
}

export function usePublicRoadmapPosts({
  roadmapId,
  statusId,
  enabled = true,
}: UsePublicRoadmapPostsOptions) {
  return useInfiniteQuery({
    queryKey: ['portal', 'roadmapPosts', roadmapId, statusId],
    queryFn: async ({ pageParam = 0 }): Promise<RoadmapPostsListResult> => {
      const { fetchPublicRoadmapPosts } = await import('@/lib/server-functions/portal')
      return fetchPublicRoadmapPosts({
        data: {
          roadmapId,
          statusId,
          limit: 20,
          offset: pageParam,
        },
      })
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * 20 : undefined),
    enabled,
  })
}

export function flattenRoadmapPosts(
  data: InfiniteData<RoadmapPostListResult> | undefined
): RoadmapPost[] {
  if (!data?.pages) return []
  return data.pages.flatMap((page) => page?.items ?? []).filter((item) => item?.id)
}

export function flattenRoadmapPostEntries(
  data: InfiniteData<RoadmapPostsListResult> | undefined
): RoadmapPostEntry[] {
  if (!data?.pages) return []
  return data.pages.flatMap((page) => page?.items ?? []).filter((item) => item?.id)
}
