/**
 * Auth helper functions for server functions.
 *
 * These provide role-based authentication checks for use in server function handlers.
 */

import type { UserId, PrincipalId, WorkspaceId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import type { Role } from '@/lib/server/auth'
import { auth } from '@/lib/server/auth'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getSettings } from './workspace'
import { db, principal, eq } from '@/lib/server/db'
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
  /** Best-effort client IP for audit attribution. */
  ipAddress: string | null
  /** Best-effort user-agent (truncated to 500 chars) for audit attribution. */
  userAgent: string | null
  /** Audit source for write paths originating from web sessions. */
  source: 'web'
}

/**
 * Extract best-effort client IP + user-agent from request headers.
 */
function readRequestContext(): { ipAddress: string | null; userAgent: string | null } {
  try {
    const headers = getRequestHeaders()
    const get = (k: string): string | null => {
      const v = (headers as unknown as Record<string, string | string[] | undefined>)[k]
      if (!v) return null
      return Array.isArray(v) ? (v[0] ?? null) : v
    }
    const cf = get('cf-connecting-ip')
    const xff = get('x-forwarded-for')
    const ip = cf ?? (xff ? (xff.split(',')[0]?.trim() ?? null) : null)
    const ua = get('user-agent')
    return { ipAddress: ip, userAgent: ua ? ua.slice(0, 500) : null }
  } catch {
    return { ipAddress: null, userAgent: null }
  }
}

/**
 * Require authentication with optional role check.
 * Throws if user is not authenticated or doesn't have required role.
 *
 * @example
 * // Require any team member
 * const auth = await requireAuth({ roles: ['admin', 'member'] })
 *
 * // Require admin only
 * const auth = await requireAuth({ roles: ['admin'] })
 *
 * // Just require authentication (any role)
 * const auth = await requireAuth()
 */
export async function requireAuth(options?: { roles?: Role[] }): Promise<AuthContext> {
  log.debug({ roles: options?.roles }, 'require auth')
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

    if (options?.roles && !options.roles.includes(principalRecord.role as Role)) {
      throw new Error(
        `Access denied: Requires [${options.roles.join(', ')}], got ${principalRecord.role}`
      )
    }

    const reqCtx = readRequestContext()
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
      ipAddress: reqCtx.ipAddress,
      userAgent: reqCtx.userAgent,
      source: 'web',
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

    let principalRecord = await db.query.principal.findFirst({
      where: eq(principal.userId, userId),
    })

    // Auto-create principal record for authenticated users without one
    if (!principalRecord) {
      const newPrincipalId = generateId('principal')
      const [created] = await db
        .insert(principal)
        .values({
          id: newPrincipalId,
          userId,
          role: 'user',
          displayName: session.user.name,
          avatarUrl: session.user.image ?? null,
          createdAt: new Date(),
        })
        .returning()
      principalRecord = created
    }

    const reqCtx = readRequestContext()
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
      ipAddress: reqCtx.ipAddress,
      userAgent: reqCtx.userAgent,
      source: 'web',
    }
  } catch (error) {
    log.error({ err: error }, 'get optional auth failed')
    throw error
  }
}

// ============================================================================
// Permission-based auth (Phase 1: ticketing RBAC)
// ============================================================================

import {
  loadPermissionSet,
  hasPermission,
  hasPermissionForResource,
  type PermissionSet,
} from '@/lib/server/domains/authz/authz.service'
import type { PermissionKey, ResourceScope } from '@/lib/server/domains/authz'
import { ForbiddenError } from '@/lib/shared/errors'

/**
 * AuthContext extended with the principal's permission set.
 *
 * Built by `requirePermission` and the upcoming ticketing helpers; the
 * permission set is loaded once per request and reused for downstream checks
 * to avoid extra round-trips to `principal_role_assignments`.
 */
export interface AuthContextWithPermissions extends AuthContext {
  permissions: PermissionSet
}

/**
 * Like `requireAuth`, but additionally requires the principal to hold
 * `permission`. Loads the full permission set so subsequent checks in the
 * same request are free.
 *
 * For permissions that depend on a specific resource (e.g. team-scoped
 * grants), pass `resource` to evaluate the scope.
 *
 * @example
 *   const ctx = await requirePermission(PERMISSIONS.TICKET_REPLY_PUBLIC, {
 *     primaryTeamId: ticket.primaryTeamId,
 *   })
 */
export async function requirePermission(
  permission: PermissionKey,
  resource?: ResourceScope
): Promise<AuthContextWithPermissions> {
  const auth = await requireAuth()
  const set = await loadPermissionSet(auth.principal.id)
  const ok = resource
    ? hasPermissionForResource(set, permission, resource)
    : hasPermission(set, permission)
  if (!ok) {
    throw new ForbiddenError('PERMISSION_DENIED', `Missing required permission: ${permission}`)
  }
  return { ...auth, permissions: set }
}

/**
 * Load `AuthContext` plus permission set without enforcing any specific
 * permission. Useful for endpoints that need to perform multiple
 * `hasPermission` checks themselves (e.g. listing tickets across scopes).
 */
export async function requireAuthWithPermissions(): Promise<AuthContextWithPermissions> {
  const auth = await requireAuth()
  const set = await loadPermissionSet(auth.principal.id)
  return { ...auth, permissions: set }
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
  }
}
