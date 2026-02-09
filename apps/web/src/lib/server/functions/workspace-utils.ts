/**
 * Workspace auth for route loaders (beforeLoad).
 *
 * These throw redirect() for unauthenticated users, making them suitable
 * for route guards. For server functions, use requireAuth() from auth-helpers.ts.
 */

import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { getSession } from './auth'
import { db, principal, eq } from '@/lib/server/db'

const requireWorkspaceRoleSchema = z.object({
  allowedRoles: z.array(z.string()),
})

/**
 * Route guard: require authenticated user with specific workspace role.
 * Throws redirect to '/' if not authenticated or lacks required role.
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
  .inputValidator(requireWorkspaceRoleSchema)
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session?.user) {
      throw redirect({ to: '/' })
    }

    const appSettings = await db.query.settings.findFirst()
    if (!appSettings) {
      throw redirect({ to: '/' })
    }

    // Note: Onboarding check is handled in __root.tsx beforeLoad

    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.userId, session.user.id),
    })
    if (!principalRecord) {
      throw redirect({ to: '/' })
    }

    if (!data.allowedRoles.includes(principalRecord.role)) {
      throw redirect({ to: '/admin/login', search: { error: 'not_team_member' } })
    }

    return {
      settings: appSettings,
      principal: principalRecord,
      user: session.user,
    }
  })
