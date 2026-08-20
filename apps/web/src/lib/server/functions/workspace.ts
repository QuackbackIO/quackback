/**
 * Workspace data reads.
 *
 * These are plain async functions, not `createServerFn` handlers, because
 * every caller is server-side (route loaders' server functions, API route
 * handlers). A `createServerFn` that no client module references never lands
 * in the server-function manifest, so its server-side callers resolve an RPC
 * stub whose ID the manifest cannot resolve — a runtime crash in production
 * builds. Keep anything called only from the server a plain function; the
 * build guard in `scripts/check-server-fn-manifest.ts` enforces this.
 */

import type { Role } from '@/lib/shared/roles'
import { db, principal, eq } from '@/lib/server/db'
import { getSession } from '@/lib/server/auth/session'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'workspace' })

/**
 * Get the app settings.
 *
 * Returns the RAW settings row: JSON config columns (featureFlags, authConfig,
 * portalConfig, ...) come back as unparsed text. For parsed, default-merged
 * reads use the settings domain service (getWorkspaceSettings / isFeatureEnabled)
 * instead of casting a column off this row.
 */
export async function getSettings() {
  const org = await db.query.settings.findFirst()
  return org ?? null
}

/**
 * Get current user's role if logged in
 */
export async function getCurrentUserRole(): Promise<Role | null> {
  log.debug('get current user role')
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
  return principalRecord.role as Role
}

/**
 * Validate API workspace access
 */
export async function validateApiWorkspaceAccess() {
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
}

export type ApiWorkspaceResult = Awaited<ReturnType<typeof validateApiWorkspaceAccess>>
