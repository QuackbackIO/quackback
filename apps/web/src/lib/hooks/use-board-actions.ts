import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchBoards,
  fetchBoard,
  createBoardFn,
  updateBoardFn,
  deleteBoardFn,
  type CreateBoardInput,
  type UpdateBoardInput,
  type DeleteBoardInput,
} from '@/lib/server-functions/boards'
import type { Board } from '@/lib/db-types'
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
 * Hook to list all boards.
 */
export function useBoards({ enabled = true }: UseBoardsOptions = {}) {
  return useQuery({
    queryKey: boardKeys.lists(),
    queryFn: fetchBoards,
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

interface UseBoardDetailOptions {
  boardId: BoardId
  enabled?: boolean
}

/**
 * Hook to get a single board by ID.
 */
export function useBoardDetail({ boardId, enabled = true }: UseBoardDetailOptions) {
  return useQuery({
    queryKey: boardKeys.detail(boardId),
    queryFn: () => fetchBoard({ data: { id: boardId } }),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new board.
 */
export function useCreateBoard() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateBoardInput) => createBoardFn({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: boardKeys.lists() })
      const previous = queryClient.getQueryData<Board[]>(boardKeys.lists())

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
      queryClient.setQueryData<Board[]>(boardKeys.lists(), (old) =>
        old ? [...old, optimisticBoard] : [optimisticBoard]
      )

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(boardKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() })
    },
  })
}

/**
 * Hook to update an existing board.
 */
export function useUpdateBoard() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateBoardInput) => updateBoardFn({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: boardKeys.lists() })
      await queryClient.cancelQueries({ queryKey: boardKeys.detail(input.id as BoardId) })
      const previousList = queryClient.getQueryData<Board[]>(boardKeys.lists())
      const previousDetail = queryClient.getQueryData<Board>(boardKeys.detail(input.id as BoardId))

      // Optimistic update for list
      // Cast settings to BoardSettings since input uses string[] but Board expects StatusId[]
      const optimisticSettings = input.settings as Board['settings'] | undefined
      queryClient.setQueryData<Board[]>(boardKeys.lists(), (old) =>
        old?.map((board) => {
          if (board.id !== input.id) return board
          return {
            ...board,
            ...(input.name !== undefined && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
            ...(optimisticSettings !== undefined && { settings: optimisticSettings }),
            updatedAt: new Date(),
          }
        })
      )

      // Optimistic update for detail
      if (previousDetail) {
        queryClient.setQueryData<Board>(boardKeys.detail(input.id as BoardId), {
          ...previousDetail,
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
          ...(optimisticSettings !== undefined && { settings: optimisticSettings }),
          updatedAt: new Date(),
        })
      }

      return { previousList, previousDetail }
    },
    onError: (_err, input, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(boardKeys.lists(), context.previousList)
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(boardKeys.detail(input.id as BoardId), context.previousDetail)
      }
    },
    onSettled: (_data, _error, input) => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() })
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(input.id as BoardId) })
    },
  })
}

/**
 * Hook to delete a board.
 */
export function useDeleteBoard() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: DeleteBoardInput) => deleteBoardFn({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: boardKeys.lists() })
      await queryClient.cancelQueries({ queryKey: boardKeys.detail(input.id as BoardId) })
      const previous = queryClient.getQueryData<Board[]>(boardKeys.lists())

      queryClient.setQueryData<Board[]>(boardKeys.lists(), (old) =>
        old?.filter((board) => board.id !== input.id)
      )
      queryClient.removeQueries({ queryKey: boardKeys.detail(input.id as BoardId) })

      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(boardKeys.lists(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() })
    },
  })
}
