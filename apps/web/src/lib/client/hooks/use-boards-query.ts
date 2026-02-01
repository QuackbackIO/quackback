/**
 * Board query hooks
 *
 * Query hooks for fetching board data.
 * Mutations are in @/lib/client/mutations/boards.
 */

import { useQuery } from '@tanstack/react-query'
import { fetchBoards, fetchBoard } from '@/lib/server/functions/boards'
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
