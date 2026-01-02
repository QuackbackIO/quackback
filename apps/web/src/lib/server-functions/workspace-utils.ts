/**
 * Workspace auth for route loaders (beforeLoad).
 *
 * These throw redirect() for unauthenticated users, making them suitable
 * for route guards. For server functions, use requireAuth() from auth-helpers.ts.
 */

import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { z } from 'zod'

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
    const { getSession } = await import('./auth')
    const { db, member, eq } = await import('@/lib/db')

    const session = await getSession()
    if (!session?.user) {
      throw redirect({ to: '/' })
    }

    const appSettings = await db.query.settings.findFirst()
    if (!appSettings) {
      throw redirect({ to: '/' })
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id),
    })
    if (!memberRecord) {
      throw redirect({ to: '/' })
    }

    if (!data.allowedRoles.includes(memberRecord.role)) {
      throw redirect({ to: '/' })
    }

    return {
      settings: appSettings,
      member: memberRecord,
      user: session.user,
    }
  })
