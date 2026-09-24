/**
 * Auth helper functions for server functions.
 *
 * These provide role-based authentication checks for use in server function handlers.
 */

import type { UserId, PrincipalId, WorkspaceId } from '@quackback/ids'
import type { Role } from '@/lib/server/auth'
import { toSessionScope, sessionRole, type SessionScope } from '@/lib/shared/roles'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { PermissionKey, Principal } from '@/lib/server/db'
import { ensurePrincipalForUser } from '@/lib/server/domains/principals/principal.factory'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { requireSettingsCached } from '@/lib/server/domains/settings/settings.helpers'
import {
  getRequestPrincipal,
  getRequestSession,
  IDENTITY_MEMO_PREFIX,
  rememberRequestPrincipal,
  type RequestSession,
} from '@/lib/server/auth/request-session'
import { memoizePerRequest } from './auth-request-cache'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'auth-helpers' })

export type RequireAuthOptions = {
  permission?: PermissionKey
}

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
 * The request's session, read directly (not through a server function, which
 * would nest) and shared with every other identity read in the request.
 */
async function getSessionDirect(): Promise<RequestSession | null> {
  try {
    return await getRequestSession()
  } catch (error) {
    log.error({ err: error }, 'get session failed')
    return null
  }
}

/**
 * The workspace settings row, served from the Redis-cached workspace-settings blob
 * (a single Redis GET when warm) and additionally memoized per request. This is
 * the auth-helper READ path only — never a read-modify-write, which must keep
 * using the uncached settings read so a write is never based on a cached row.
 * Returns null when unconfigured (getOptionalAuth's public surfaces treat that
 * as "no auth" rather than an error).
 */
async function getAuthSettings() {
  return memoizePerRequest('settings', async () => {
    try {
      return await requireSettingsCached()
    } catch (error) {
      log.error({ err: error }, 'auth settings read failed')
      return null
    }
  })
}

/**
 * The principal's assignment-derived permission set, resolved once per request.
 * Keyed on the role as well, so a role change that drops the principal from
 * the request memo can never be answered with the old role's grants.
 */
function requestPermissions(record: Principal): Promise<ReadonlySet<PermissionKey>> {
  return memoizePerRequest(`${IDENTITY_MEMO_PREFIX}permissions:${record.id}:${record.role}`, () =>
    permissionsForPrincipal(record.id as PrincipalId, record.role as Role)
  )
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
  /**
   * The caller's resolved (assignment-derived) permission set. Required so no
   * consumer ever falls back to the wider legacy preset expansion for a
   * context that skipped resolution — with custom roles the resolved set can
   * be narrower than the preset, and a fallback would silently widen.
   */
  permissions: PermissionKey[]
  /** Session audience; only 'dashboard' may carry permissions. */
  scope: SessionScope
}

/**
 * Site authentication (dashboard + portal cookies). Widget Bearers are denied;
 * widget surfaces use `requireWidgetAuth` instead.
 *
 * `{ permission }` is dashboard-only (unchanged).
 */
export async function requireAuth(options?: RequireAuthOptions): Promise<AuthContext> {
  log.debug({ permission: options?.permission }, 'require auth')
  const session = await getSessionDirect()
  if (!session?.user) {
    throw new Error('Authentication required')
  }
  const userId = session.user.id as UserId
  const scope = toSessionScope(session.session.scope)
  if (scope === 'widget') {
    throw new Error('Access denied: Widget sessions cannot access this resource')
  }

  const appSettings = await getAuthSettings()
  if (!appSettings) {
    throw new Error('Workspace not configured')
  }

  // Both reads are shared with every other identity read in the request.
  const principalRecord = await getRequestPrincipal(userId)
  if (!principalRecord) {
    throw new Error('Access denied: Not a team member')
  }
  const resolvedPermissions = await requestPermissions(principalRecord)

  const role: Role = sessionRole(principalRecord.role as Role, scope)
  // Non-dashboard audiences never carry team authority downstream.
  const permissions: PermissionKey[] = scope === 'dashboard' ? [...resolvedPermissions] : []

  if (options?.permission && scope !== 'dashboard') {
    throw new Error(
      `Access denied: Requires permission '${options.permission}' on a dashboard session`
    )
  }

  if (options?.permission && !permissions.includes(options.permission)) {
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
      role,
      type: principalRecord.type,
    },
    permissions,
    scope,
  }
}

// The denial-vocabulary matcher for the throws above lives in the pure leaf
// module auth-errors.ts (so consumers and tests can reach the real matcher
// without this module's auth-stack import graph); re-exported here so the
// vocabulary and its matcher still travel together for existing importers.
export { isAuthDenialError } from './auth-errors'

/** Cloud/admin lifecycle mutations: widget and portal sessions cannot act as owner. */
export function assertDashboardScope(auth: Pick<AuthContext, 'scope'>): void {
  if (auth.scope !== 'dashboard') {
    throw new Error('Access denied: Requires a dashboard session')
  }
}

/**
 * Assert the authenticated caller holds a permission, throwing the same
 * canonical message `requireAuth({ permission })` uses. For the rare gate
 * whose required permission is computed at runtime (a field- or action-scoped
 * write), so the gate must stay a bare `requireAuth()` for the authz scanner
 * while the per-action permission is still enforced. Consumes the gate's
 * already-resolved (assignment-derived) permission set — never a legacy
 * fallback, which could be wider than a custom role's actual grant.
 */
export function assertPermission(
  auth: Pick<AuthContext, 'permissions' | 'principal' | 'scope'>,
  permission: PermissionKey
): void {
  if (auth.scope !== 'dashboard') {
    throw new Error(`Access denied: Requires permission '${permission}' on a dashboard session`)
  }
  if (!auth.permissions.includes(permission)) {
    throw new Error(
      `Access denied: Requires permission '${permission}', role ${auth.principal.role} lacks it`
    )
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
  const session = await getSessionDirect()
  if (!session?.user) {
    return null
  }
  const userId = session.user.id as UserId
  const scope = toSessionScope(session.session.scope)
  if (scope === 'widget') {
    return null
  }

  const appSettings = await getAuthSettings()
  if (!appSettings) {
    return null
  }

  // Resolve (or lazily create) the caller's principal. The read is shared
  // with the rest of the request; the create runs once per request and the
  // factory is race-safe against a concurrent first-touch.
  const principalRecord =
    (await getRequestPrincipal(userId)) ??
    (await memoizePerRequest(`${IDENTITY_MEMO_PREFIX}ensure-principal:${userId}`, async () => {
      const { principal: record } = await ensurePrincipalForUser({
        userId,
        role: 'user',
        displayName: session.user.name,
        avatarUrl: session.user.image ?? null,
      })
      rememberRequestPrincipal(record)
      return record
    }))

  // Same assignment-derived resolution as requireAuth, so portal/public
  // surfaces that gate on the optional context honour custom roles too.
  // End users (role 'user') never carry workspace assignments (the role
  // reconcile and seed heal enforce that), so the dominant portal case
  // skips the join instead of paying a guaranteed-empty DB read.
  const resolvedPermissions: ReadonlySet<PermissionKey> =
    principalRecord.role === 'user'
      ? new Set<PermissionKey>()
      : await requestPermissions(principalRecord)

  const role: Role = sessionRole(principalRecord.role as Role, scope)
  // Non-dashboard audiences never carry team authority downstream.
  const permissions: PermissionKey[] = scope === 'dashboard' ? [...resolvedPermissions] : []

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
      role,
      type: principalRecord.type,
    },
    permissions,
    scope,
  }
}

// ============================================================================
// Policy actor resolution
// ============================================================================

import type { Actor, PrincipalType } from '@/lib/server/policy/types'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'
import { segmentIdsForPrincipal } from '@/lib/server/domains/segments/segment-membership.service'

/**
 * Preserve known principal types. Collapsing 'anonymous' onto 'user'
 * is a security bug: a Better Auth anonymous session would satisfy
 * audience.kind='authenticated' and dodge the workspace requireApproval='anonymous'
 * moderation gate. Collapsing 'support' onto 'user' would put Cloud support
 * back on people lists (`isIdentifiedHuman`).
 */
export function normalizePrincipalType(raw: string | null | undefined): PrincipalType {
  if (raw === 'service') return 'service'
  if (raw === 'anonymous') return 'anonymous'
  if (raw === 'support') return 'support'
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
    permissions: new Set(auth.permissions),
  }
}
