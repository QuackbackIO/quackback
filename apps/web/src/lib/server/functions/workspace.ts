/**
 * Server functions for workspace data fetching.
 */

import { createServerFn } from '@tanstack/react-start'
import { db, principal, eq } from '@/lib/server/db'
import { getSession } from '@/lib/server/auth/session'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'workspace' })

/**
 * Get the app settings.
 *
 * Returns the RAW settings row: JSON config columns (featureFlags, authConfig,
 * portalConfig, ...) come back as unparsed text. For parsed, default-merged
 * reads use the settings domain service (getTenantSettings / isFeatureEnabled)
 * instead of casting a column off this row.
 */
export const getSettings = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const org = await db.query.settings.findFirst()
    return org ?? null
  } catch (error) {
    log.error({ err: error }, 'get settings failed')
    throw error
  }
})

/**
 * Get current user's role if logged in
 */
export const getCurrentUserRole = createServerFn({ method: 'GET' }).handler(
  async (): Promise<'admin' | 'member' | 'user' | null> => {
    log.debug('get current user role')
    try {
      const session = await getSession()
      if (!session?.user) {
        log.debug('no session')
        return null
      }

      const principalRecord = await db.query.principal.findFirst({
        where: eq(principal.userId, session.user.id),
      })

      if (!principalRecord) {
        log.debug('no principal')
        return null
      }
      log.debug({ role: principalRecord.role }, 'current user role')
      return principalRecord.role as 'admin' | 'member' | 'user'
    } catch (error) {
      log.error({ err: error }, 'get current user role failed')
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
    log.error({ err: error }, 'validate api workspace access failed')
    throw error
  }
})

export type ApiWorkspaceResult = Awaited<ReturnType<typeof validateApiWorkspaceAccess>>
