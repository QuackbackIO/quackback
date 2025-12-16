'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Board, BoardSettings } from '@/lib/db/types'
import type { CreateBoardInput } from '@/lib/schemas/boards'

// ============================================================================
// Query Key Factory
// ============================================================================

export const boardKeys = {
  all: ['boards'] as const,
  lists: () => [...boardKeys.all, 'list'] as const,
  list: (organizationId: string) => [...boardKeys.lists(), organizationId] as const,
  details: () => [...boardKeys.all, 'detail'] as const,
  detail: (boardId: string) => [...boardKeys.details(), boardId] as const,
}

// ============================================================================
// Types
// ============================================================================

type CreateBoardResponse = Board

type UpdateBoardResponse = Board

interface DeleteBoardResponse {
  success: boolean
}

// ============================================================================
// Mutation Hooks
// ============================================================================

export function useCreateBoard(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateBoardInput): Promise<CreateBoardResponse> => {
      const response = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, organizationId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create board')
      }

      return response.json()
    },
    onSuccess: () => {
      // Invalidate board lists to refetch
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() })
    },
  })
}

interface UpdateBoardInput_Full {
  boardId: string
  name?: string
  description?: string | null
  isPublic?: boolean
  settings?: BoardSettings
}

export function useUpdateBoard(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      boardId,
      ...input
    }: UpdateBoardInput_Full): Promise<UpdateBoardResponse> => {
      const response = await fetch(`/api/boards/${boardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, organizationId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update board')
      }

      return response.json()
    },
    onSuccess: (data, { boardId }) => {
      // Update the specific board in cache
      queryClient.setQueryData<Board>(boardKeys.detail(boardId), data)
      // Invalidate lists to reflect changes
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() })
    },
  })
}

export function useDeleteBoard(organizationId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (boardId: string): Promise<DeleteBoardResponse> => {
      const response = await fetch(`/api/boards/${boardId}?organizationId=${organizationId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete board')
      }

      return response.json()
    },
    onSuccess: (_data, boardId) => {
      // Remove board from cache
      queryClient.removeQueries({ queryKey: boardKeys.detail(boardId) })
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() })
    },
  })
}
