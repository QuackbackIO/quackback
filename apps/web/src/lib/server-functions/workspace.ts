/**
 * Server functions for workspace data fetching.
 *
 * Server Functions (createServerFn):
 * - getSettings: Fetch app settings
 * - getCurrentUserRole: Get current user's role
 * - validateApiWorkspaceAccess: Validate API access
 *
 * See also: workspace-utils.ts for requireWorkspace and requireWorkspaceRole.
 */

import { createServerFn } from '@tanstack/react-start'
import { db, member, eq } from '@/lib/db'
import { tenantStorage } from '@/lib/tenant'
import { isMultiTenant } from '@/lib/features'
import { getSession } from './auth'

/**
 * Check if tenant is available for database access.
 * Returns false only in multi-tenant mode when no tenant was resolved.
 * Use this to guard database calls in routes.
 */
export const checkTenantAvailable = createServerFn({ method: 'GET' }).handler(async () => {
  if (isMultiTenant() && !tenantStorage.getStore()) {
    return false
  }
  return true
})

/**
 * Get the app settings.
 * Returns settings from the request context (queried once at request start in server.ts).
 * Falls back to database query if context not available (e.g., during build).
 */
export const getSettings = createServerFn({ method: 'GET' }).handler(async () => {
  // Get settings from request context (populated in server.ts)
  const ctx = tenantStorage.getStore()
  if (ctx?.settings !== undefined) {
    console.log(`[fn:workspace] getSettings: from context`)
    return ctx.settings
  }

  // Fallback to database query if no context (e.g., during SSG build)
  console.log(`[fn:workspace] getSettings: fallback to db query`)
  try {
    const org = await db.query.settings.findFirst()
    console.log(`[fn:workspace] getSettings: found=${!!org}`)
    return org ?? null
  } catch (error) {
    console.error(`[fn:workspace] ❌ getSettings failed:`, error)
    throw error
  }
})

/**
 * Get current user's role if logged in
 */
export const getCurrentUserRole = createServerFn({ method: 'GET' }).handler(
  async (): Promise<'admin' | 'member' | 'user' | null> => {
    console.log(`[fn:workspace] getCurrentUserRole`)
    try {
      const session = await getSession()
      if (!session?.user) {
        console.log(`[fn:workspace] getCurrentUserRole: no session`)
        return null
      }

      const memberRecord = await db.query.member.findFirst({
        where: eq(member.userId, session.user.id),
      })

      if (!memberRecord) {
        console.log(`[fn:workspace] getCurrentUserRole: no member`)
        return null
      }
      console.log(`[fn:workspace] getCurrentUserRole: role=${memberRecord.role}`)
      return memberRecord.role as 'admin' | 'member' | 'user'
    } catch (error) {
      console.error(`[fn:workspace] ❌ getCurrentUserRole failed:`, error)
      throw error
    }
  }
)

/**
 * Validate API workspace access
 */
export const validateApiWorkspaceAccess = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:workspace] validateApiWorkspaceAccess`)
  try {
    const session = await getSession()
    if (!session?.user) {
      console.log(`[fn:workspace] validateApiWorkspaceAccess: no session`)
      return { success: false as const, error: 'Unauthorized', status: 401 as const }
    }

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id),
    })

    if (!memberRecord) {
      console.log(`[fn:workspace] validateApiWorkspaceAccess: no member`)
      return { success: false as const, error: 'Forbidden', status: 403 as const }
    }

    const appSettings = await db.query.settings.findFirst()
    if (!appSettings) {
      console.log(`[fn:workspace] validateApiWorkspaceAccess: no settings`)
      return { success: false as const, error: 'Settings not found', status: 403 as const }
    }

    console.log(`[fn:workspace] validateApiWorkspaceAccess: success, role=${memberRecord.role}`)
    return {
      success: true as const,
      settings: appSettings,
      member: memberRecord,
      user: session.user,
    }
  } catch (error) {
    console.error(`[fn:workspace] ❌ validateApiWorkspaceAccess failed:`, error)
    throw error
  }
})

export type ApiWorkspaceResult = Awaited<ReturnType<typeof validateApiWorkspaceAccess>>
