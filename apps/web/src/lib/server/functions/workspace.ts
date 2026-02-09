/**
 * Server functions for workspace data fetching.
 */

import { createServerFn } from '@tanstack/react-start'
import { db, principal, eq } from '@/lib/server/db'
import { getSession } from './auth'

/**
 * Get the app settings.
 */
export const getSettings = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const org = await db.query.settings.findFirst()
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

      const principalRecord = await db.query.principal.findFirst({
        where: eq(principal.userId, session.user.id),
      })

      if (!principalRecord) {
        console.log(`[fn:workspace] getCurrentUserRole: no principal`)
        return null
      }
      console.log(`[fn:workspace] getCurrentUserRole: role=${principalRecord.role}`)
      return principalRecord.role as 'admin' | 'member' | 'user'
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
  try {
    const session = await getSession()
    if (!session?.user) {
      return { success: false as const, error: 'Unauthorized', status: 401 as const }
    }

    const [principalRecord, appSettings] = await Promise.all([
      db.query.principal.findFirst({
        where: eq(principal.userId, session.user.id),
      }),
      db.query.settings.findFirst(),
    ])

    if (!principalRecord) {
      return { success: false as const, error: 'Forbidden', status: 403 as const }
    }

    if (!appSettings) {
      return { success: false as const, error: 'Settings not found', status: 403 as const }
    }

    return {
      success: true as const,
      settings: appSettings,
      principal: principalRecord,
      user: session.user,
    }
  } catch (error) {
    console.error(`[fn:workspace] ❌ validateApiWorkspaceAccess failed:`, error)
    throw error
  }
})

export type ApiWorkspaceResult = Awaited<ReturnType<typeof validateApiWorkspaceAccess>>
