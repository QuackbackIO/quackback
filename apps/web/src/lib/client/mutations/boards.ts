/**
 * Board mutations
 *
 * Mutation hooks for board CRUD operations.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createBoardFn,
  updateBoardFn,
  updateBoardAccessFn,
  deleteBoardFn,
  type CreateBoardInput,
  type UpdateBoardInput,
  type DeleteBoardInput,
} from '@/lib/server/functions/boards'
import { accessForPreset } from '@/lib/shared/schemas/boards'
import type { Board, BoardAccess } from '@/lib/shared/db-types'
import type { BoardId } from '@quackback/ids'
import { boardKeys } from '@/lib/client/hooks/use-boards-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { slugify } from '@/lib/shared/utils'

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

      // Mirror the server's createBoardFn preset→access mapping so the
      // optimistic row matches what the server will actually insert. The
      // shared helper is the single source of truth.
      const optimisticBoard: Board = {
        id: `board_temp_${Date.now()}` as Board['id'],
        name: input.name,
        slug: slugify(input.name),
        description: input.description ?? null,
        access: accessForPreset(input.preset ?? 'public'),
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
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
      queryClient.invalidateQueries({ queryKey: adminQueries.boardsForSettings().queryKey })
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
      queryClient.invalidateQueries({ queryKey: adminQueries.boardsForSettings().queryKey })
    },
  })
}

/**
 * Hook to update board access policy.
 *
 * Admin-only server-side. Use this from the Access tab; never from the
 * general-update path, which mustn't carry visibility changes.
 */
export function useUpdateBoardAccess() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { boardId: BoardId; access: BoardAccess }) =>
      updateBoardAccessFn({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: boardKeys.lists() })
      await queryClient.cancelQueries({ queryKey: boardKeys.detail(input.boardId) })
      const previousList = queryClient.getQueryData<Board[]>(boardKeys.lists())
      const previousDetail = queryClient.getQueryData<Board>(boardKeys.detail(input.boardId))

      const accessPatch: Partial<Pick<Board, 'access'>> = { access: input.access }

      queryClient.setQueryData<Board[]>(boardKeys.lists(), (old) =>
        old?.map((board) =>
          board.id !== input.boardId
            ? board
            : {
                ...board,
                ...accessPatch,
                updatedAt: new Date(),
              }
        )
      )

      if (previousDetail) {
        queryClient.setQueryData<Board>(boardKeys.detail(input.boardId), {
          ...previousDetail,
          ...accessPatch,
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
        queryClient.setQueryData(boardKeys.detail(input.boardId), context.previousDetail)
      }
    },
    onSettled: (_data, _error, input) => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() })
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(input.boardId) })
      queryClient.invalidateQueries({ queryKey: adminQueries.boardsForSettings().queryKey })
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
      queryClient.invalidateQueries({ queryKey: adminQueries.boardsForSettings().queryKey })
    },
  })
}
