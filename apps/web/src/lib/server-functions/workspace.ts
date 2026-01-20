/**
 * Server functions for workspace data fetching.
 *
 * Server Functions (createServerFn):
 * - getRequestContext: Get discriminated request context (app-domain, self-hosted, tenant, unknown)
 * - getSettings: Fetch app settings
 * - getCurrentUserRole: Get current user's role
 * - validateApiWorkspaceAccess: Validate API access
 *
 * See also: workspace-utils.ts for requireWorkspace and requireWorkspaceRole.
 */

import { createServerFn } from '@tanstack/react-start'
import { db, member, eq } from '@/lib/db'
import { tenantStorage, type RequestContext } from '@/lib/tenant'
import { getSession } from './auth'

/**
 * Get the request context as a discriminated union.
 * Replaces checkIsAppDomain() and checkTenantAvailable() with a single call.
 *
 * Returns:
 * - { type: 'app-domain' } - Request is on app domain (e.g., app.quackback.io)
 * - { type: 'self-hosted', settings } - Self-hosted mode with DATABASE_URL singleton
 * - { type: 'tenant', workspaceId, settings } - Multi-tenant mode with resolved tenant
 * - { type: 'unknown' } - Multi-tenant mode with no resolved tenant for domain
 */
export const getRequestContext = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RequestContext> => {
    const store = tenantStorage.getStore()

    if (!store) {
      return { type: 'unknown' }
    }

    switch (store.contextType) {
      case 'app-domain':
        return { type: 'app-domain' }
      case 'self-hosted':
        return { type: 'self-hosted', settings: store.settings }
      case 'tenant':
        return {
          type: 'tenant',
          workspaceId: store.workspaceId ?? '',
          settings: store.settings,
        }
      case 'unknown':
        return { type: 'unknown' }
    }
  }
)

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
