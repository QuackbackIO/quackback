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

const log = logger.child({ component: 'workspace-utils' })

const requireWorkspaceRoleSchema = z.object({
  allowedRoles: z.array(z.string()),
})

/**
 * Route guard: require authenticated user with specific workspace role.
 * Unauthenticated callers go to `/auth/login?callbackUrl=/admin` when
 * guarding admin routes (the unified login renders the team break-glass
 * form for the `/admin` callback, so a session expiry takes the customer
 * back to a sign-in surface, not the public portal); other callers fall
 * back to '/'.
 *
 * Use in route beforeLoad:
 * @example
 * beforeLoad: async () => {
 *   const { user, member } = await requireWorkspaceRole({
 *     data: { allowedRoles: ['admin', 'member'] }
 *   })
 *   return { user, member }
 * }
 */
export const requireWorkspaceRole = createServerFn({ method: 'GET' })
  .validator(requireWorkspaceRoleSchema)
  .handler(async ({ data }) => {
    log.debug({ allowed_roles: data.allowedRoles }, 'require workspace role')
    // If the route restricts to team roles only, unauthenticated
    // callers belong on the unified login with a `/admin` callback (the
    // team break-glass form). If the route also allows role='user'
    // (public portal), fall back to '/' for the regular sign-in flow.
    const teamOnly = data.allowedRoles.every(isTeamMember)
    const unauthRedirect = teamOnly
      ? { to: '/auth/login' as const, search: { callbackUrl: '/admin' } }
      : { to: '/' as const }
    try {
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
        throw redirect({
          to: '/auth/login',
          search: { callbackUrl: '/admin', error: 'not_team_member' },
        })
      }

      return {
        settings: appSettings,
        principal: principalRecord,
        user: session.user,
      }
    } catch (error) {
      log.error({ err: error }, 'require workspace role failed')
      throw error
    }
  })
