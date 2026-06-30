/**
 * Auth helper functions for server functions.
 *
 * These provide role-based authentication checks for use in server function handlers.
 */

import type { UserId, PrincipalId, WorkspaceId } from '@quackback/ids'
import type { Role } from '@/lib/server/auth'
import { auth } from '@/lib/server/auth'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getSettings } from './workspace'
import { db, principal, eq, type PermissionKey } from '@/lib/server/db'
import { ensurePrincipalForUser } from '@/lib/server/domains/principals/principal.factory'
import { permissionsForLegacyRole, resolveActorPermissions } from '@/lib/server/policy/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'auth-helpers' })

// Type alias for session result
type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>

/**
 * Quick check if the request has a session cookie.
 * This allows early bailout for anonymous users WITHOUT hitting the database.
 * Use this before calling getOptionalAuth() for endpoints that return
 * default/empty data for anonymous users.
 */
export function hasSessionCookie(): boolean {
  const headers = getRequestHeaders()
  const cookie = headers.get('cookie') ?? ''
  return cookie.includes('better-auth.session_token')
}

/**
 * Check if the request has any form of authentication (cookie or Bearer token).
 * Use this instead of hasSessionCookie() when the endpoint should support
 * both portal (cookie) and widget (Bearer token) authentication.
 */
export function hasAuthCredentials(): boolean {
  const headers = getRequestHeaders()
  const cookie = headers.get('cookie') ?? ''
  const auth = headers.get('authorization') ?? ''
  return cookie.includes('better-auth.session_token') || auth.startsWith('Bearer ')
}

/**
 * Get session directly from better-auth (not through server function).
 * This avoids nested server function call issues.
 */
async function getSessionDirect(): Promise<SessionResult | null> {
  try {
    return await auth.api.getSession({ headers: getRequestHeaders() })
  } catch (error) {
    log.error({ err: error }, 'get session failed')
    return null
  }
}

export type { Role }

export interface AuthContext {
  settings: {
    id: WorkspaceId
    slug: string
    name: string
    logoKey: string | null
  }
  user: {
    id: UserId
    email: string
    name: string
    image: string | null
  }
  principal: {
    id: PrincipalId
    role: Role
    type: string
  }
}

/**
 * Require authentication with an optional role OR permission check.
 *
 * `{ permission }` is the forward path: it checks the caller's resolved
 * permission set (derived from their role's preset bundle via the compat shim),
 * so call sites can migrate off role strings incrementally. `{ roles }` is the
 * legacy path, kept unchanged and provably equivalent per role until the Phase C
 * completion gate retires it. Passing both checks both.
 *
 * @example
 * // Permission gate (preferred)
 * const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
 *
 * // Just require authentication (any role)
 * const auth = await requireAuth()
 */
export async function requireAuth(options?: {
  roles?: Role[]
  permission?: PermissionKey
}): Promise<AuthContext> {
  log.debug({ roles: options?.roles, permission: options?.permission }, 'require auth')
  try {
    const session = await getSessionDirect()
    if (!session?.user) {
      throw new Error('Authentication required')
    }
    const userId = session.user.id as UserId

    const appSettings = await getSettings()
    if (!appSettings) {
      throw new Error('Workspace not configured')
    }

    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.userId, userId),
    })

    if (!principalRecord) {
      throw new Error('Access denied: Not a team member')
    }

    const role = principalRecord.role as Role

    if (options?.roles && !options.roles.includes(role)) {
      throw new Error(`Access denied: Requires [${options.roles.join(', ')}], got ${role}`)
    }

    if (options?.permission && !permissionsForLegacyRole(role).has(options.permission)) {
      throw new Error(
        `Access denied: Requires permission '${options.permission}', role ${role} lacks it`
      )
    }

    return {
      settings: {
        id: appSettings.id as WorkspaceId,
        slug: appSettings.slug,
        name: appSettings.name,
        logoKey: appSettings.logoKey ?? null,
      },
      user: {
        id: userId,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image ?? null,
      },
      principal: {
        id: principalRecord.id as PrincipalId,
        role: principalRecord.role as Role,
        type: principalRecord.type,
      },
    }
  } catch (error) {
    log.error({ err: error }, 'require auth failed')
    throw error
  }
}

/**
 * Get auth context if authenticated, null otherwise.
 * Useful for public endpoints that behave differently for logged-in users.
 *
 * Auto-creates a member record with role 'user' for authenticated users
 * who don't have one (e.g., users who signed up via OTP).
 */
export async function getOptionalAuth(): Promise<AuthContext | null> {
  log.debug('get optional auth')
  try {
    const session = await getSessionDirect()
    if (!session?.user) {
      return null
    }
    const userId = session.user.id as UserId

    const appSettings = await getSettings()
    if (!appSettings) {
      return null
    }

    // Resolve (or lazily create) the caller's principal. The factory is
    // read-first and race-safe against a concurrent first-touch.
    const { principal: principalRecord } = await ensurePrincipalForUser({
      userId,
      role: 'user',
      displayName: session.user.name,
      avatarUrl: session.user.image ?? null,
    })

    return {
      settings: {
        id: appSettings.id as WorkspaceId,
        slug: appSettings.slug,
        name: appSettings.name,
        logoKey: appSettings.logoKey ?? null,
      },
      user: {
        id: userId,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image ?? null,
      },
      principal: {
        id: principalRecord.id as PrincipalId,
        role: principalRecord.role as Role,
        type: principalRecord.type,
      },
    }
  } catch (error) {
    log.error({ err: error }, 'get optional auth failed')
    throw error
  }
}

// ============================================================================
// Policy actor resolution
// ============================================================================

import type { Actor, PrincipalType } from '@/lib/server/policy/types'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'
import { segmentIdsForPrincipal } from '@/lib/server/domains/segments/segment-membership.service'

/**
 * Preserve all three principal types. Collapsing 'anonymous' onto 'user'
 * is a security bug: a Better Auth anonymous session would satisfy
 * audience.kind='authenticated' and dodge the workspace requireApproval='anonymous'
 * moderation gate.
 */
export function normalizePrincipalType(raw: string | null | undefined): PrincipalType {
  if (raw === 'service') return 'service'
  if (raw === 'anonymous') return 'anonymous'
  return 'user'
}

/**
 * Build a policy Actor from an AuthContext. Resolves segment memberships
 * via segmentIdsForPrincipal. Returns ANONYMOUS_ACTOR for null auth.
 *
 * NOTE: this is the policy-shaped actor. The audit-log helper has a
 * separate, synchronous `actorFromAuth` returning the {userId, email,
 * role} shape — do not confuse them. See audit/log.ts.
 */
export async function policyActorFromAuth(auth: AuthContext | null): Promise<Actor> {
  if (!auth) return ANONYMOUS_ACTOR
  const segmentIds = await segmentIdsForPrincipal(auth.principal.id)
  return {
    principalId: auth.principal.id,
    role: auth.principal.role,
    principalType: normalizePrincipalType(auth.principal.type),
    segmentIds,
    permissions: resolveActorPermissions(auth.principal.role),
  }
}
