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
    console.log(`[fn:workspace-utils] requireWorkspaceRole: roles=${data.allowedRoles.join(',')}`)
    try {
      const { getSession } = await import('./auth')
      const { db, member, eq } = await import('@/lib/db')

      const session = await getSession()
      if (!session?.user) {
        console.log(`[fn:workspace-utils] requireWorkspaceRole: not authenticated, redirecting`)
        throw redirect({ to: '/' })
      }

      const appSettings = await db.query.settings.findFirst()
      if (!appSettings) {
        console.log(`[fn:workspace-utils] requireWorkspaceRole: no settings, redirecting`)
        throw redirect({ to: '/' })
      }

      const memberRecord = await db.query.member.findFirst({
        where: eq(member.userId, session.user.id),
      })
      if (!memberRecord) {
        console.log(`[fn:workspace-utils] requireWorkspaceRole: no member record, redirecting`)
        throw redirect({ to: '/' })
      }

      if (!data.allowedRoles.includes(memberRecord.role)) {
        console.log(
          `[fn:workspace-utils] requireWorkspaceRole: role=${memberRecord.role} not allowed, redirecting`
        )
        throw redirect({ to: '/' })
      }

      console.log(
        `[fn:workspace-utils] requireWorkspaceRole: authorized, role=${memberRecord.role}`
      )
      return {
        settings: appSettings,
        member: memberRecord,
        user: session.user,
      }
    } catch (error) {
      // Don't log redirect errors as failures
      if (error instanceof Error && error.message?.includes('redirect')) {
        throw error
      }
      console.error(`[fn:workspace-utils] ❌ requireWorkspaceRole failed:`, error)
      throw error
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
    console.log(`[fn:workspace-utils] requireEdition: edition=${data.edition}`)
    try {
      const requiredEdition = data.edition
      const redirectTo = data.redirectTo ?? '/admin/settings'

      if (requiredEdition === 'self-hosted' && !isSelfHosted()) {
        console.log(`[fn:workspace-utils] requireEdition: not self-hosted, redirecting`)
        throw redirect({ to: redirectTo })
      }

      if (requiredEdition === 'cloud' && !isCloud()) {
        console.log(`[fn:workspace-utils] requireEdition: not cloud, redirecting`)
        throw redirect({ to: redirectTo })
      }

      console.log(`[fn:workspace-utils] requireEdition: edition=${requiredEdition} verified`)
      return { edition: requiredEdition }
    } catch (error) {
      if (error instanceof Error && error.message?.includes('redirect')) {
        throw error
      }
      console.error(`[fn:workspace-utils] ❌ requireEdition failed:`, error)
      throw error
    }
  })

/**
 * Route guard: require self-hosted edition.
 * Convenience wrapper around requireEdition.
 */
export const requireSelfHosted = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:workspace-utils] requireSelfHosted`)
  try {
    if (!isSelfHosted()) {
      console.log(`[fn:workspace-utils] requireSelfHosted: not self-hosted, redirecting`)
      throw redirect({ to: '/admin/settings' })
    }
    console.log(`[fn:workspace-utils] requireSelfHosted: verified`)
    return { edition: 'self-hosted' as const }
  } catch (error) {
    if (error instanceof Error && error.message?.includes('redirect')) {
      throw error
    }
    console.error(`[fn:workspace-utils] ❌ requireSelfHosted failed:`, error)
    throw error
  }
})

/**
 * Route guard: require cloud edition.
 * Convenience wrapper around requireEdition.
 */
export const requireCloudEdition = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:workspace-utils] requireCloudEdition`)
  try {
    if (!isCloud()) {
      console.log(`[fn:workspace-utils] requireCloudEdition: not cloud, redirecting`)
      throw redirect({ to: '/admin/settings' })
    }
    console.log(`[fn:workspace-utils] requireCloudEdition: verified`)
    return { edition: 'cloud' as const }
  } catch (error) {
    if (error instanceof Error && error.message?.includes('redirect')) {
      throw error
    }
    console.error(`[fn:workspace-utils] ❌ requireCloudEdition failed:`, error)
    throw error
  }
})
