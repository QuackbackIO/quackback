/**
 * Auth helper functions for server functions.
 *
 * These provide role-based authentication checks for use in server function handlers.
 * All imports are done dynamically to prevent client bundling issues.
 */

import type { UserId, MemberId, WorkspaceId } from '@quackback/ids'

export type Role = 'owner' | 'admin' | 'member' | 'user'

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
  member: {
    id: MemberId
    role: Role
  }
}

/**
 * Require authentication with optional role check.
 * Throws if user is not authenticated or doesn't have required role.
 *
 * @example
 * // Require any team member
 * const auth = await requireAuth({ roles: ['owner', 'admin', 'member'] })
 *
 * // Require admin or owner
 * const auth = await requireAuth({ roles: ['owner', 'admin'] })
 *
 * // Just require authentication (any role)
 * const auth = await requireAuth()
 */
export async function requireAuth(options?: { roles?: Role[] }): Promise<AuthContext> {
  const { getSession } = await import('./auth')
  const { getSettings } = await import('./workspace')
  const { db, member, eq } = await import('@/lib/db')

  const session = await getSession()
  if (!session?.user) {
    throw new Error('Authentication required')
  }

  const appSettings = await getSettings()
  if (!appSettings) {
    throw new Error('Workspace not configured')
  }

  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id as UserId),
  })
  if (!memberRecord) {
    throw new Error('Access denied: Not a team member')
  }

  if (options?.roles && !options.roles.includes(memberRecord.role as Role)) {
    throw new Error(
      `Access denied: Requires [${options.roles.join(', ')}], got ${memberRecord.role}`
    )
  }

  return {
    settings: {
      id: appSettings.id as WorkspaceId,
      slug: appSettings.slug,
      name: appSettings.name,
    },
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
    },
    member: {
      id: memberRecord.id as MemberId,
      role: memberRecord.role as Role,
    },
  }
}

/**
 * Get auth context if authenticated, null otherwise.
 * Useful for public endpoints that behave differently for logged-in users.
 */
export async function getOptionalAuth(): Promise<AuthContext | null> {
  const { getSession } = await import('./auth')
  const { getSettings } = await import('./workspace')
  const { db, member, eq } = await import('@/lib/db')

  const session = await getSession()
  if (!session?.user) {
    return null
  }

  const appSettings = await getSettings()
  if (!appSettings) {
    return null
  }

  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id as UserId),
  })
  if (!memberRecord) {
    return null
  }

  return {
    settings: {
      id: appSettings.id as WorkspaceId,
      slug: appSettings.slug,
      name: appSettings.name,
    },
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
    },
    member: {
      id: memberRecord.id as MemberId,
      role: memberRecord.role as Role,
    },
  }
}
