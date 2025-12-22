'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useActionMutation, createListOptimisticUpdate } from './use-action-mutation'
import {
  listBoardsAction,
  createBoardAction,
  updateBoardAction,
  deleteBoardAction,
  type CreateBoardInput,
  type UpdateBoardInput,
  type DeleteBoardInput,
} from '@/lib/actions/boards'
import type { Board } from '@/lib/db/types'
import type { ActionError } from '@/lib/actions/types'
import type { WorkspaceId, BoardId } from '@quackback/ids'

// ============================================================================
// Query Key Factory
// ============================================================================

export const boardKeys = {
  all: ['boards'] as const,
  lists: () => [...boardKeys.all, 'list'] as const,
  list: (workspaceId: WorkspaceId) => [...boardKeys.lists(), workspaceId] as const,
  detail: (id: BoardId) => [...boardKeys.all, 'detail', id] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseBoardsOptions {
  workspaceId: WorkspaceId
  enabled?: boolean
}

/**
 * Hook to list all boards for a workspace.
 */
export function useBoards({ workspaceId, enabled = true }: UseBoardsOptions) {
  return useQuery({
    queryKey: boardKeys.list(workspaceId),
    queryFn: async () => {
      const result = await listBoardsAction({})
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

interface UseCreateBoardOptions {
  workspaceId: WorkspaceId
  onSuccess?: (board: Board) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to create a new board.
 *
 * @example
 * const createBoard = useCreateBoard({
 *   workspaceId,
 *   onSuccess: (board) => toast.success(`Created "${board.name}"`),
 *   onError: (error) => toast.error(error.message),
 * })
 *
 * createBoard.mutate({
 *   workspaceId,
 *   name: 'Feature Requests',
 *   description: 'Submit your feature ideas here',
 *   isPublic: true,
 * })
 */
export function useCreateBoard({ workspaceId, onSuccess, onError }: UseCreateBoardOptions) {
  const queryClient = useQueryClient()
  const listKey = boardKeys.list(workspaceId)

  return useActionMutation<CreateBoardInput, Board, { previous: Board[] | undefined }>({
    action: createBoardAction,
    invalidateKeys: [boardKeys.lists()],
    onOptimisticUpdate: (input) => {
      // Create optimistic board with temp ID
      const optimisticBoard: Board = {
        id: `board_temp_${Date.now()}` as Board['id'],
        name: input.name,
        slug: input.name.toLowerCase().replace(/\s+/g, '-'),
        description: input.description ?? null,
        isPublic: input.isPublic ?? true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const helper = createListOptimisticUpdate<Board>(queryClient, listKey)
      const previous = helper.add(optimisticBoard)
      return { previous }
    },
    onRollback: ({ previous }) => {
      queryClient.setQueryData(listKey, previous)
    },
    onSuccess,
    onError,
  })
}

interface UseUpdateBoardOptions {
  workspaceId: WorkspaceId
  onSuccess?: (board: Board) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to update an existing board.
 *
 * @example
 * const updateBoard = useUpdateBoard({
 *   workspaceId,
 *   onSuccess: (board) => toast.success(`Updated "${board.name}"`),
 * })
 *
 * updateBoard.mutate({ workspaceId, id: board.id, name: 'New Name' })
 */
export function useUpdateBoard({ workspaceId, onSuccess, onError }: UseUpdateBoardOptions) {
  const queryClient = useQueryClient()
  const listKey = boardKeys.list(workspaceId)

  return useActionMutation<UpdateBoardInput, Board, { previous: Board[] | undefined }>({
    action: updateBoardAction,
    invalidateKeys: [boardKeys.lists()],
    onOptimisticUpdate: (input) => {
      const helper = createListOptimisticUpdate<Board>(queryClient, listKey)
      // Only update fields that are actually changed
      const updates: Partial<Board> = { updatedAt: new Date() }
      if (input.name !== undefined) updates.name = input.name
      if (input.description !== undefined) updates.description = input.description
      if (input.isPublic !== undefined) updates.isPublic = input.isPublic
      if (input.settings !== undefined) updates.settings = input.settings as Record<string, unknown>

      const previous = helper.update(input.id as string, updates)
      return { previous }
    },
    onRollback: ({ previous }) => {
      queryClient.setQueryData(listKey, previous)
    },
    onSuccess,
    onError,
  })
}

interface UseDeleteBoardOptions {
  workspaceId: WorkspaceId
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to delete a board.
 *
 * @example
 * const deleteBoard = useDeleteBoard({
 *   workspaceId,
 *   onSuccess: () => toast.success('Board deleted'),
 * })
 *
 * deleteBoard.mutate({ workspaceId, id: board.id })
 */
export function useDeleteBoard({ workspaceId, onSuccess, onError }: UseDeleteBoardOptions) {
  const queryClient = useQueryClient()
  const listKey = boardKeys.list(workspaceId)

  return useActionMutation<DeleteBoardInput, { id: string }, { previous: Board[] | undefined }>({
    action: deleteBoardAction,
    invalidateKeys: [boardKeys.lists()],
    onOptimisticUpdate: (input) => {
      const helper = createListOptimisticUpdate<Board>(queryClient, listKey)
      const previous = helper.remove(input.id as string)
      return { previous }
    },
    onRollback: ({ previous }) => {
      queryClient.setQueryData(listKey, previous)
    },
    onSuccess: () => onSuccess?.(),
    onError,
  })
}
