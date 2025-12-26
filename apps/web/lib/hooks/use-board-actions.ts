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
import type { Board } from '@/lib/db'
import type { ActionError } from '@/lib/actions/types'
import type { BoardId } from '@quackback/ids'

// ============================================================================
// Query Key Factory
// ============================================================================

export const boardKeys = {
  all: ['boards'] as const,
  lists: () => [...boardKeys.all, 'list'] as const,
  detail: (id: BoardId) => [...boardKeys.all, 'detail', id] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseBoardsOptions {
  enabled?: boolean
}

/**
 * Hook to list all boards (single-tenant).
 */
export function useBoards({ enabled = true }: UseBoardsOptions = {}) {
  return useQuery({
    queryKey: boardKeys.lists(),
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
  onSuccess?: (board: Board) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to create a new board (single-tenant).
 *
 * @example
 * const createBoard = useCreateBoard({
 *   onSuccess: (board) => toast.success(`Created "${board.name}"`),
 *   onError: (error) => toast.error(error.message),
 * })
 *
 * createBoard.mutate({
 *   name: 'Feature Requests',
 *   description: 'Submit your feature ideas here',
 *   isPublic: true,
 * })
 */
export function useCreateBoard({ onSuccess, onError }: UseCreateBoardOptions = {}) {
  const queryClient = useQueryClient()
  const listKey = boardKeys.lists()

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
  onSuccess?: (board: Board) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to update an existing board (single-tenant).
 *
 * @example
 * const updateBoard = useUpdateBoard({
 *   onSuccess: (board) => toast.success(`Updated "${board.name}"`),
 * })
 *
 * updateBoard.mutate({ id: board.id, name: 'New Name' })
 */
export function useUpdateBoard({ onSuccess, onError }: UseUpdateBoardOptions = {}) {
  const queryClient = useQueryClient()
  const listKey = boardKeys.lists()

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
  onSuccess?: () => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to delete a board (single-tenant).
 *
 * @example
 * const deleteBoard = useDeleteBoard({
 *   onSuccess: () => toast.success('Board deleted'),
 * })
 *
 * deleteBoard.mutate({ id: board.id })
 */
export function useDeleteBoard({ onSuccess, onError }: UseDeleteBoardOptions = {}) {
  const queryClient = useQueryClient()
  const listKey = boardKeys.lists()

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
