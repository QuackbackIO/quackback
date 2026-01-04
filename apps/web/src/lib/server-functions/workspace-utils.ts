/**
 * Workspace auth for route loaders (beforeLoad).
 *
 * These throw redirect() for unauthenticated users, making them suitable
 * for route guards. For server functions, use requireAuth() from auth-helpers.ts.
 */

import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { isSelfHosted, isCloud } from '@/lib/features'

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

// ============================================================================
// Edition Guards
// ============================================================================

const requireEditionSchema = z.object({
  edition: z.enum(['self-hosted', 'cloud']),
  redirectTo: z.string().optional(),
})

/**
 * Route guard: require specific edition (self-hosted or cloud).
 * Throws redirect if running in wrong edition.
 *
 * Use in route beforeLoad:
 * @example
 * beforeLoad: async () => {
 *   await requireEdition({ data: { edition: 'self-hosted' } })
 * }
 */
export const requireEdition = createServerFn({ method: 'GET' })
  .inputValidator(requireEditionSchema)
  .handler(async ({ data }) => {
    const requiredEdition = data.edition
    const redirectTo = data.redirectTo ?? '/admin/settings'

    if (requiredEdition === 'self-hosted' && !isSelfHosted()) {
      throw redirect({ to: redirectTo })
    }

    if (requiredEdition === 'cloud' && !isCloud()) {
      throw redirect({ to: redirectTo })
    }

    return { edition: requiredEdition }
  })

/**
 * Route guard: require self-hosted edition.
 * Convenience wrapper around requireEdition.
 */
export const requireSelfHosted = createServerFn({ method: 'GET' }).handler(async () => {
  if (!isSelfHosted()) {
    throw redirect({ to: '/admin/settings' })
  }
  return { edition: 'self-hosted' as const }
})

/**
 * Route guard: require cloud edition.
 * Convenience wrapper around requireEdition.
 */
export const requireCloudEdition = createServerFn({ method: 'GET' }).handler(async () => {
  if (!isCloud()) {
    throw redirect({ to: '/admin/settings' })
  }
  return { edition: 'cloud' as const }
})
