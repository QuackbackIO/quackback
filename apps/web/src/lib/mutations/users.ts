/**
 * User mutations
 *
 * Mutation hooks for portal user management.
 * Query hooks are in @/lib/hooks/use-users-queries.
 */

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { MemberId } from '@quackback/ids'
import type { PortalUserListResultView, PortalUserListItemView } from '@/lib/users'
import { deletePortalUserFn } from '@/lib/server-functions/admin'
import { usersKeys } from '@/lib/hooks/use-users-queries'

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to remove a portal user from an organization.
 * This deletes their member record and org-scoped user account.
 */
export function useRemovePortalUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (memberId: MemberId) => deletePortalUserFn({ data: { memberId } }),
    onMutate: async (memberId) => {
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
                (user: PortalUserListItemView) => user.memberId !== memberId
              ),
              total: page.total - 1,
            })),
          }
        }
      )

      return { previousLists }
    },
    onError: (_err, _memberId, context) => {
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
