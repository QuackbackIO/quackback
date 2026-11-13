import { queryOptions } from '@tanstack/react-query'
import { fetchWorkspaceKeyRolesFn } from '@/lib/server/functions/workspace-api-key-settings'

/** The roles a workspace key may be given, marked with whether the caller can grant each. */
export const workspaceKeyRolesQuery = () =>
  queryOptions({
    queryKey: ['admin', 'api-keys', 'roles'],
    queryFn: () => fetchWorkspaceKeyRolesFn(),
    staleTime: 30 * 1000,
  })
