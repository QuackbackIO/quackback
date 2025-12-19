'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Roadmap } from '@/lib/db/types'

export const roadmapsKeys = {
  all: ['roadmaps'] as const,
  list: (workspaceId: string) => [...roadmapsKeys.all, 'list', workspaceId] as const,
  publicList: (workspaceId: string) => [...roadmapsKeys.all, 'public', workspaceId] as const,
  detail: (roadmapId: string) => [...roadmapsKeys.all, 'detail', roadmapId] as const,
}

interface UseRoadmapsOptions {
  workspaceId: string
  enabled?: boolean
}

/**
 * Hook to fetch all roadmaps for an organization (admin)
 */
export function useRoadmaps({ workspaceId, enabled = true }: UseRoadmapsOptions) {
  return useQuery({
    queryKey: roadmapsKeys.list(workspaceId),
    queryFn: async (): Promise<Roadmap[]> => {
      const response = await fetch(`/api/roadmaps?workspaceId=${encodeURIComponent(workspaceId)}`)
      if (!response.ok) {
        throw new Error('Failed to fetch roadmaps')
      }
      return response.json()
    },
    enabled,
  })
}

/**
 * Hook to fetch public roadmaps for an organization (portal)
 */
export function usePublicRoadmaps({ workspaceId, enabled = true }: UseRoadmapsOptions) {
  return useQuery({
    queryKey: roadmapsKeys.publicList(workspaceId),
    queryFn: async (): Promise<Roadmap[]> => {
      const response = await fetch(
        `/api/public/roadmaps?workspaceId=${encodeURIComponent(workspaceId)}`
      )
      if (!response.ok) {
        throw new Error('Failed to fetch public roadmaps')
      }
      return response.json()
    },
    enabled,
  })
}

interface CreateRoadmapInput {
  name: string
  slug: string
  description?: string
  isPublic?: boolean
}

/**
 * Hook to create a new roadmap
 */
export function useCreateRoadmap(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateRoadmapInput): Promise<Roadmap> => {
      const response = await fetch('/api/roadmaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, workspaceId }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create roadmap')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(workspaceId) })
    },
  })
}

interface UpdateRoadmapInput {
  name?: string
  description?: string
  isPublic?: boolean
}

/**
 * Hook to update a roadmap
 */
export function useUpdateRoadmap(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      roadmapId,
      input,
    }: {
      roadmapId: string
      input: UpdateRoadmapInput
    }): Promise<Roadmap> => {
      const response = await fetch(`/api/roadmaps/${roadmapId}?workspaceId=${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, workspaceId }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update roadmap')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(workspaceId) })
    },
  })
}

/**
 * Hook to delete a roadmap
 */
export function useDeleteRoadmap(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (roadmapId: string): Promise<void> => {
      const response = await fetch(`/api/roadmaps/${roadmapId}?workspaceId=${workspaceId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete roadmap')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(workspaceId) })
    },
  })
}

/**
 * Hook to reorder roadmaps
 */
export function useReorderRoadmaps(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (roadmapIds: string[]): Promise<void> => {
      const response = await fetch('/api/roadmaps/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roadmapIds, workspaceId }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to reorder roadmaps')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(workspaceId) })
    },
  })
}
