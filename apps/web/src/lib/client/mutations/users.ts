/**
 * User mutations
 *
 * Mutation hooks for portal user management.
 * Query hooks are in @/lib/client/hooks/use-users-queries.
 */

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { PrincipalId } from '@quackback/ids'
import type { PortalUserListResultView, PortalUserListItemView } from '@/lib/server/domains/users'
import {
  createPortalUserFn,
  deletePortalUserFn,
  updatePortalUserFn,
} from '@/lib/server/functions/admin'
import { usersKeys } from '@/lib/client/hooks/use-users-queries'

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to create a new portal user (for admin author attribution).
 */
export function useCreatePortalUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { name: string; email?: string }) => createPortalUserFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'team', 'members'] })
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
    },
  })
}

/**
 * Hook to update a portal user's details (name, email).
 */
export function useUpdatePortalUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { principalId: string; name?: string; email?: string | null }) =>
      updatePortalUserFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
      queryClient.invalidateQueries({ queryKey: usersKeys.details() })
    },
  })
}

/**
 * Hook to remove a portal user from an organization.
 * This deletes their member record and org-scoped user account.
 */
export function useRemovePortalUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (principalId: PrincipalId) => deletePortalUserFn({ data: { principalId } }),
    onMutate: async (principalId) => {
      await queryClient.cancelQueries({ queryKey: usersKeys.lists() })

      const previousLists = queryClient.getQueriesData<InfiniteData<PortalUserListResultView>>({
        queryKey: usersKeys.lists(),
      })

      // Optimistically remove from list caches
      queryClient.setQueriesData<InfiniteData<PortalUserListResultView>>(
        { queryKey: usersKeys.lists() },
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.filter(
                (user: PortalUserListItemView) => user.principalId !== principalId
              ),
              total: page.total - 1,
            })),
          }
        }
      )

      return { previousLists }
    },
    onError: (_err, _principalId, context) => {
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
    },
  })
}
