/**
 * User tag query + mutation hooks.
 *
 * Tags live in their own cache subtree (`['admin', 'user-tags']`); assign and
 * remove invalidate it plus the users lists (a tag edit changes what the
 * People-list tag filter matches) and the per-principal tag query.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PrincipalId, UserTagId } from '@quackback/ids'
import {
  listUserTagsFn,
  listUserTagsForPrincipalFn,
  assignUserTagFn,
  removeUserTagFn,
} from '@/lib/server/functions/admin'
import { usersKeys } from '@/lib/client/hooks/use-users-queries'

export const userTagsKeys = {
  all: ['admin', 'user-tags'] as const,
  forPrincipal: (principalId: PrincipalId) => [...userTagsKeys.all, principalId] as const,
}

export function useUserTags() {
  return useQuery({
    queryKey: userTagsKeys.all,
    queryFn: () => listUserTagsFn(),
  })
}

export function useUserTagsForPrincipal(principalId: PrincipalId | undefined) {
  return useQuery({
    queryKey: userTagsKeys.forPrincipal(principalId as PrincipalId),
    queryFn: () =>
      listUserTagsForPrincipalFn({ data: { principalId: principalId as PrincipalId } }),
    enabled: !!principalId,
  })
}

export function useAssignUserTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { principalId: PrincipalId; tagId?: UserTagId; name?: string }) =>
      assignUserTagFn({ data }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: userTagsKeys.all })
      queryClient.invalidateQueries({ queryKey: userTagsKeys.forPrincipal(variables.principalId) })
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
    },
  })
}

export function useRemoveUserTag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { principalId: PrincipalId; tagId: UserTagId }) => removeUserTagFn({ data }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: userTagsKeys.all })
      queryClient.invalidateQueries({ queryKey: userTagsKeys.forPrincipal(variables.principalId) })
      queryClient.invalidateQueries({ queryKey: usersKeys.lists() })
    },
  })
}
