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
 * Get session directly from better-auth (not through server function).
 * This avoids nested server function call issues.
 */
async function getSessionDirect(): Promise<SessionResult | null> {
  try {
    return await auth.api.getSession({ headers: getRequestHeaders() })
  } catch (error) {
    console.error('[auth] Failed to get session:', error)
    return null
  }
}

export type { Role }

export interface AuthContext {
  settings: {
    id: WorkspaceId
    slug: string
    name: string
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

  return {
    settings: {
      id: appSettings.id as WorkspaceId,
      slug: appSettings.slug,
      name: appSettings.name,
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
    },
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

  return {
    settings: {
      id: appSettings.id as WorkspaceId,
      slug: appSettings.slug,
      name: appSettings.name,
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
    },
  }
}
