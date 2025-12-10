'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Roadmap } from '@quackback/db/types'

export const roadmapsKeys = {
  all: ['roadmaps'] as const,
  list: (organizationId: string) => [...roadmapsKeys.all, 'list', organizationId] as const,
  publicList: (organizationId: string) => [...roadmapsKeys.all, 'public', organizationId] as const,
  detail: (roadmapId: string) => [...roadmapsKeys.all, 'detail', roadmapId] as const,
}

interface UseRoadmapsOptions {
  organizationId: string
  enabled?: boolean
}

/**
 * Hook to fetch all roadmaps for an organization (admin)
 */
export function useRoadmaps({ organizationId, enabled = true }: UseRoadmapsOptions) {
  return useQuery({
    queryKey: roadmapsKeys.list(organizationId),
    queryFn: async (): Promise<Roadmap[]> => {
      const response = await fetch(
        `/api/roadmaps?organizationId=${encodeURIComponent(organizationId)}`
      )
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
export function usePublicRoadmaps({ organizationId, enabled = true }: UseRoadmapsOptions) {
  return useQuery({
    queryKey: roadmapsKeys.publicList(organizationId),
    queryFn: async (): Promise<Roadmap[]> => {
      const response = await fetch(
        `/api/public/roadmaps?organizationId=${encodeURIComponent(organizationId)}`
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
export function useCreateRoadmap(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateRoadmapInput): Promise<Roadmap> => {
      const response = await fetch('/api/roadmaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, organizationId }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create roadmap')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(organizationId) })
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
export function useUpdateRoadmap(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      roadmapId,
      input,
    }: {
      roadmapId: string
      input: UpdateRoadmapInput
    }): Promise<Roadmap> => {
      const response = await fetch(`/api/roadmaps/${roadmapId}?organizationId=${organizationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, organizationId }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update roadmap')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(organizationId) })
    },
  })
}

/**
 * Hook to delete a roadmap
 */
export function useDeleteRoadmap(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (roadmapId: string): Promise<void> => {
      const response = await fetch(`/api/roadmaps/${roadmapId}?organizationId=${organizationId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete roadmap')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(organizationId) })
    },
  })
}

/**
 * Hook to reorder roadmaps
 */
export function useReorderRoadmaps(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (roadmapIds: string[]): Promise<void> => {
      const response = await fetch('/api/roadmaps/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roadmapIds, organizationId }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to reorder roadmaps')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roadmapsKeys.list(organizationId) })
    },
  })
}
