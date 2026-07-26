/**
 * Workspace auth for route loaders (beforeLoad).
 *
 * These throw redirect() for unauthenticated users, making them suitable
 * for route guards. For server functions, use requireAuth() from auth-helpers.ts.
 */

import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { z } from 'zod'
import type { UserId } from '@quackback/ids'
import { getSession } from '@/lib/server/auth/session'
import { db, principal, eq } from '@/lib/server/db'
import { isTeamMember } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'
import { buildSigninRedirect } from '@/lib/shared/auth-prompt'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import type { Role } from '@/lib/shared/roles'
import { ALL_PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { withErrorLog } from './with-error-log'

const log = logger.child({ component: 'workspace-utils' })

const requireWorkspaceRoleSchema = z.object({
  allowedRoles: z.array(z.string()),
  /**
   * Additionally require this permission from the caller's resolved
   * (assignment-derived) set. Admin-area pages gate on `allowedRoles:
   * ['admin', 'member']` (the teammate wall) plus the permission their server
   * functions actually enforce, so a custom role holding the page's
   * capability can reach the page.
   */
  permission: z
    .string()
    .refine((v) => (ALL_PERMISSIONS as readonly string[]).includes(v), 'Unknown permission key')
    .optional(),
})

/**
 * Route guard: require authenticated user with specific workspace role, and
 * optionally a resolved permission.
 * Unauthenticated callers on team-only routes are sent to the portal
 * sign-in dialog with `callbackUrl=/admin`. Callers on routes that also
 * allow role='user' (public portal) fall back to '/'.
 *
 * Use in route beforeLoad:
 * @example
 * beforeLoad: async () => {
 *   const { user, member } = await requireWorkspaceRole({
 *     data: { allowedRoles: ['admin', 'member'], permission: PERMISSIONS.SETTINGS_MANAGE }
 *   })
 *   return { user, member }
 * }
 */
export const requireWorkspaceRole = createServerFn({ method: 'GET' })
  .validator(requireWorkspaceRoleSchema)
  .handler(async ({ data }) => {
    log.debug({ allowed_roles: data.allowedRoles }, 'require workspace role')
    // Team-only routes send unauthenticated callers to the sign-in dialog
    // with a /admin callback. Routes that also allow role='user' (public
    // portal) fall back to '/' for the regular sign-in flow.
    const teamOnly = data.allowedRoles.every(isTeamMember)
    const unauthRedirect = teamOnly ? buildSigninRedirect('/admin') : { to: '/' as const }
    return withErrorLog(log, 'require workspace role', async () => {
      const session = await getSession()
      if (!session?.user) {
        throw redirect(unauthRedirect)
      }

      const appSettings = await db.query.settings.findFirst()
      if (!appSettings) {
        throw redirect({ to: '/' })
      }

      // Note: Onboarding check is handled in __root.tsx beforeLoad

      const principalRecord = await db.query.principal.findFirst({
        where: eq(principal.userId, session.user.id as UserId),
      })
      if (!principalRecord) {
        throw redirect(unauthRedirect)
      }

      if (!data.allowedRoles.includes(principalRecord.role)) {
        throw redirect(buildSigninRedirect('/admin', { error: 'not_team_member' }))
      }

      const resolvedPermissions = await permissionsForPrincipal(
        principalRecord.id,
        principalRecord.role as Role
      )

      if (data.permission && !resolvedPermissions.has(data.permission as PermissionKey)) {
        throw redirect(buildSigninRedirect('/admin', { error: 'not_team_member' }))
      }

      return {
        settings: appSettings,
        principal: principalRecord,
        user: session.user,
        permissions: [...resolvedPermissions],
      }
    })
  })
