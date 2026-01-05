/**
 * Auth helper functions for server functions.
 *
 * These provide role-based authentication checks for use in server function handlers.
 * All imports are done dynamically to prevent client bundling issues.
 */

import type { UserId, MemberId, WorkspaceId } from '@quackback/ids'
import type { Role } from '@/lib/auth'

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
 * const auth = await requireAuth({ roles: ['admin', 'member'] })
 *
 * // Require admin only
 * const auth = await requireAuth({ roles: ['admin'] })
 *
 * // Just require authentication (any role)
 * const auth = await requireAuth()
 */
export async function requireAuth(options?: { roles?: Role[] }): Promise<AuthContext> {
  const { getSession } = await import('./auth')
  const { getSettings } = await import('./workspace')
  const { db, member, eq } = await import('@/lib/db')

  console.log(`[auth] Checking session...`)
  const session = await getSession()
  if (!session?.user) {
    console.warn(`[auth] ⚠️ No session`)
    throw new Error('Authentication required')
  }
  console.log(`[auth] Session: user=${session.user.id}`)

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
    console.warn(
      `[auth] ⚠️ Role denied: required=[${options.roles.join(',')}], actual=${memberRecord.role}`
    )
    throw new Error(
      `Access denied: Requires [${options.roles.join(', ')}], got ${memberRecord.role}`
    )
  }

  console.log(`[auth] ✅ Authorized: role=${memberRecord.role}`)
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
 *
 * Auto-creates a member record with role 'user' for authenticated users
 * who don't have one (e.g., users who signed up via OTP).
 */
export async function getOptionalAuth(): Promise<AuthContext | null> {
  const { getSession } = await import('./auth')
  const { getSettings } = await import('./workspace')
  const { db, member, eq } = await import('@/lib/db')
  const { generateId } = await import('@quackback/ids')

  const session = await getSession()
  if (!session?.user) {
    console.log(`[auth] Optional auth: no session`)
    return null
  }
  console.log(`[auth] Optional auth: user=${session.user.id}`)

  const appSettings = await getSettings()
  if (!appSettings) {
    return null
  }

  let memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id as UserId),
  })

  // Auto-create member record for authenticated users without one
  if (!memberRecord) {
    console.log(`[auth] 📦 Creating member record for user=${session.user.id}`)
    const newMemberId = generateId('member')
    const [created] = await db
      .insert(member)
      .values({
        id: newMemberId,
        userId: session.user.id as UserId,
        role: 'user',
        createdAt: new Date(),
      })
      .returning()
    memberRecord = created
    console.log(`[auth] ✅ Member created: id=${newMemberId}`)
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
