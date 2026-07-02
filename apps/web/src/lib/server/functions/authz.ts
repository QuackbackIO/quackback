/**
 * Authz / permission server-fns for client UI.
 *
 * `getMyPermissionsFn` returns the current actor's permission set in a
 * client-friendly serialised shape; consumed by `useMyPermissions()` and
 * the `<PermissionGate />` primitive to gate UI affordances.
 */
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId, TeamId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import type { PermissionKey } from '@/lib/server/domains/authz'

export interface MyPermissionsResult {
  principalId: PrincipalId
  workspacePermissions: PermissionKey[]
  teamPermissions: Array<{ teamId: TeamId; permissions: PermissionKey[] }>
  teamIds: TeamId[]
}

export const getMyPermissionsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MyPermissionsResult> => {
    const auth = await requireAuth({ roles: ['admin', 'member', 'user'] })
    const set = await loadPermissionSet(auth.principal.id)
    return {
      principalId: set.principalId,
      workspacePermissions: Array.from(set.workspacePermissions),
      teamPermissions: Array.from(set.teamPermissions.entries()).map(([teamId, perms]) => ({
        teamId,
        permissions: Array.from(perms),
      })),
      teamIds: Array.from(set.teamIds),
    }
  }
)
