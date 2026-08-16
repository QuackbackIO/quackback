/**
 * User mutations
 *
 * Mutation hooks for portal user management.
 * Query hooks are in @/lib/client/hooks/use-users-queries.
 */

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { PrincipalId } from '@quackback/ids'
import type { PortalUserListResultView, PortalUserListItemView } from '@/lib/shared/types'
import {
  createPortalUserFn,
  deletePortalUserFn,
  mergeLeadIntoUserFn,
  updatePortalUserFn,
} from '@/lib/server/functions/admin'
import { usersKeys } from '@/lib/client/hooks/use-users-queries'
import { toast } from 'sonner'

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
 * Hook to update a portal user's details (name, email). An email edit can
 * create or dissolve an address collision, so the duplicate-match queries
 * refresh too.
 */
export function useUpdatePortalUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { principalId: string; name?: string; email?: string | null }) =>
      updatePortalUserFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
      queryClient.invalidateQueries({ queryKey: usersKeys.details() })
      queryClient.invalidateQueries({ queryKey: ['admin', 'user-duplicates'] })
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
    onError: (err, _principalId, context) => {
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          if (data) {
            queryClient.setQueryData(queryKey, data)
          }
        }
      }
      toast.error(err instanceof Error ? err.message : 'Failed to remove portal user')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
    },
  })
}

/**
 * Hook to merge a lead into an identified portal user. The lead row disappears
 * and the target's detail gains the activity, so the whole users tree is stale.
 */
export function useMergeLeadIntoUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { principalId: PrincipalId; targetPrincipalId: PrincipalId }) =>
      mergeLeadIntoUserFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKeys.all })
    },
  })
}
