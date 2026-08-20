/**
 * Workspace data reads shared by SSR loaders, other server functions and the
 * API route handlers.
 *
 * These are deliberately plain async functions rather than `createServerFn`
 * declarations. Nothing on the client calls them — every caller is already
 * running on the server — so the RPC hop would only dispatch the server back
 * into itself. It would also not survive the build: the server-function
 * manifest is emitted from the registrations collected while the client graph
 * is compiled, so a server function the client never references is absent from
 * it and every call throws `Server function info not found`. Keep these plain;
 * `bun run check:server-fn-manifest` guards the general case.
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
