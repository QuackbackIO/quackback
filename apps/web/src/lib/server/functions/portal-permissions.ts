import { createServerFn } from '@tanstack/react-start'
import type { PermissionKey } from '@/lib/shared/permissions'
import { isTeamMember } from '@/lib/shared/roles'
import { getOptionalAuth, hasSessionCookie } from './auth-helpers'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'portal-permissions' })

/**
 * The caller's resolved RBAC permission keys, for portal UI gating only.
 *
 * Render-only convenience: the portal layout loads this once per request so
 * components can decide what team affordances to show. Every mutation is still
 * independently enforced server-side via requireAuth({ permission }), so a
 * stale or wrong value here can never grant real access.
 *
 * Returns [] for end users, anonymous principals, and unauthenticated
 * requests — the portal is a public surface and this must never throw for a
 * logged-out visitor. Returns the gate-resolved (assignment-derived) set from
 * getOptionalAuth, so custom roles are honoured here too.
 */
export const getMyPortalPermissionsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PermissionKey[]> => {
    // Cheap bailout: no session cookie means no principal, no DB read needed.
    if (!hasSessionCookie()) return []
    try {
      const auth = await getOptionalAuth()
      if (!auth) return []
      // Anonymous sessions carry a real cookie but hold nothing; end users
      // (role 'user') have no team permissions either.
      if (auth.principal.type === 'anonymous') return []
      if (!isTeamMember(auth.principal.role)) return []
      // Gate-resolved (assignment-derived) set from getOptionalAuth.
      return auth.permissions ?? []
    } catch (error) {
      // Fail open to "no permissions" — this only hides UI affordances, and
      // throwing would take down the whole portal layout loader.
      log.warn({ err: error }, 'portal permission resolution failed')
      return []
    }
  }
)
