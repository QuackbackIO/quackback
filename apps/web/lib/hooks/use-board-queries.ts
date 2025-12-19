'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Board, BoardSettings } from '@/lib/db/types'
import type { WorkspaceId, BoardId } from '@quackback/ids'
import { createBoardAction, updateBoardAction, deleteBoardAction } from '@/lib/actions/boards'

// ============================================================================
// Query Key Factory
// ============================================================================

export const boardKeys = {
  all: ['boards'] as const,
  lists: () => [...boardKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...boardKeys.lists(), workspaceId] as const,
  details: () => [...boardKeys.all, 'detail'] as const,
  detail: (boardId: string) => [...boardKeys.details(), boardId] as const,
}

// ============================================================================
// Types
// ============================================================================

interface CreateBoardInput {
  name: string
  description?: string
  isPublic?: boolean
}

// ============================================================================
// Mutation Hooks
// ============================================================================

export function useCreateBoard(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateBoardInput): Promise<Board> => {
      const result = await createBoardAction({
        workspaceId,
        name: input.name,
        description: input.description,
        isPublic: input.isPublic ?? true,
      })

      if (!result.success) {
        throw new Error(result.error.message)
      }

      return result.data as Board
    },
    onSuccess: () => {
      // Invalidate board lists to refetch
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() })
    },
  })
}

interface UpdateBoardInput_Full {
  boardId: BoardId
  name?: string
  description?: string | null
  isPublic?: boolean
  settings?: BoardSettings
}

export function useUpdateBoard(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ boardId, ...input }: UpdateBoardInput_Full): Promise<Board> => {
      const result = await updateBoardAction({
        workspaceId,
        id: boardId,
        name: input.name,
        description: input.description,
        isPublic: input.isPublic,
        settings: input.settings as Record<string, unknown> | undefined,
      })

      if (!result.success) {
        throw new Error(result.error.message)
      }

      return result.data as Board
    },
    onSuccess: (data, { boardId }) => {
      // Update the specific board in cache
      queryClient.setQueryData<Board>(boardKeys.detail(boardId), data)
      // Invalidate lists to reflect changes
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() })
    },
  })
}

export function useDeleteBoard(workspaceId: WorkspaceId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (boardId: BoardId): Promise<{ id: string }> => {
      const result = await deleteBoardAction({
        workspaceId,
        id: boardId,
      })

      if (!result.success) {
        throw new Error(result.error.message)
      }

      return result.data
    },
    onSuccess: (_data, boardId) => {
      // Remove board from cache
      queryClient.removeQueries({ queryKey: boardKeys.detail(boardId) })
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() })
    },
  })
}
