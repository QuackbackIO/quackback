/**
 * Server functions for workspace data fetching.
 *
 * Server Functions (createServerFn):
 * - getSettings: Fetch app settings
 * - getCurrentUserRole: Get current user's role
 * - validateApiWorkspaceAccess: Validate API access
 *
 * NOTE: All DB and server-only imports are done dynamically inside handlers
 * to prevent client bundling issues with TanStack Start.
 *
 * See also: workspace-utils.ts for requireWorkspace and requireWorkspaceRole.
 */

import { createServerFn } from '@tanstack/react-start'

/**
 * Get the app settings.
 * Returns the singleton settings record from the database.
 */
export const getSettings = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:workspace] getSettings`)
  try {
    const { db } = await import('@/lib/db')

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
      const { getSession } = await import('./auth')
      const { db, member, eq } = await import('@/lib/db')

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
    const { getSession } = await import('./auth')
    const { db, member, eq } = await import('@/lib/db')

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
