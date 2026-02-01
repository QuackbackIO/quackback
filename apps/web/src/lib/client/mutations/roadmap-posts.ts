/**
 * Roadmap posts mutations
 *
 * Mutation hooks for adding/removing posts from roadmaps.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { RoadmapId, PostId } from '@quackback/ids'
import { addPostToRoadmapFn, removePostFromRoadmapFn } from '@/lib/server/functions/roadmaps'
import { roadmapPostsKeys } from '@/lib/client/hooks/use-roadmap-posts-query'

/**
 * Hook to add a post to a roadmap.
 */
export function useAddPostToRoadmap(roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (postId: PostId) => addPostToRoadmapFn({ data: { roadmapId, postId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...roadmapPostsKeys.all, 'roadmap', roadmapId] })
    },
  })
}

/**
 * Hook to remove a post from a roadmap.
 */
export function useRemovePostFromRoadmap(roadmapId: RoadmapId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (postId: PostId) => removePostFromRoadmapFn({ data: { roadmapId, postId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...roadmapPostsKeys.all, 'roadmap', roadmapId] })
    },
  })
}
