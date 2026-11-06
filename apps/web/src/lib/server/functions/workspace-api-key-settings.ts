/**
 * The roles a workspace key may be given (api_key.manage), for the new
 * workspace key page and the change role dialog. Kept apart from
 * functions/api-keys.ts, whose list function every page's entry chunk carries.
 */
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'

/** The roles a workspace key may be given, each marked with whether the caller can grant it. */
export const fetchWorkspaceKeyRolesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })
  const { listWorkspaceKeyRoleOptions } =
    await import('@/lib/server/domains/api-keys/api-key-management')
  return listWorkspaceKeyRoleOptions({ permissions: auth.permissions, role: auth.principal.role })
})
