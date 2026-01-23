/**
 * Auth helper functions for server functions.
 *
 * These provide role-based authentication checks for use in server function handlers.
 */

import type { UserId, MemberId, WorkspaceId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import type { Role } from '@/lib/auth'
import { auth } from '@/lib/auth'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getSettings } from './workspace'
import { db, member, eq, type Member } from '@/lib/db'
import { tenantStorage } from '@/lib/tenant'

// Type alias for session result
type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>

/** Check if session is cached (distinguishes cache miss from cached null) */
function hasSessionCache(): boolean {
  const ctx = tenantStorage.getStore()
  return ctx?.cache.has('session') ?? false
}

/** Get session from request-scoped cache */
function getCachedSession(): SessionResult | null {
  const ctx = tenantStorage.getStore()
  return (ctx?.cache.get('session') as SessionResult | null) ?? null
}

/** Store session in request-scoped cache */
function setCachedSession(data: SessionResult | null): void {
  const ctx = tenantStorage.getStore()
  ctx?.cache.set('session', data)
}

/** Get member from request-scoped cache (returns undefined if not cached) */
function getCachedMember(userId: UserId): Member | undefined {
  const ctx = tenantStorage.getStore()
  return ctx?.cache.get(`member:${userId}`) as Member | undefined
}

/** Store member in request-scoped cache (only cache if member exists) */
function setCachedMember(userId: UserId, data: Member): void {
  const ctx = tenantStorage.getStore()
  ctx?.cache.set(`member:${userId}`, data)
}

/**
 * Get session directly from better-auth (not through server function).
 * This avoids nested server function call issues.
 * Results are cached per-request to avoid redundant auth lookups.
 */
async function getSessionDirect(): Promise<SessionResult | null> {
  // Check cache first (use has() to distinguish cache miss from cached null)
  if (hasSessionCache()) {
    return getCachedSession()
  }

  try {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })

    // Cache the result (including null to avoid repeated lookups)
    setCachedSession(session)

    return session
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
  console.log(`[auth] Checking session...`)
  const session = await getSessionDirect()
  if (!session?.user) {
    console.warn(`[auth] ⚠️ No session`)
    throw new Error('Authentication required')
  }
  const userId = session.user.id as UserId
  console.log(`[auth] Session: user=${userId}`)

  const appSettings = await getSettings()
  if (!appSettings) {
    throw new Error('Workspace not configured')
  }

  // Check member cache first
  let memberRecord = getCachedMember(userId)
  if (memberRecord) {
    console.log(`[auth] Member cache hit for user=${userId}`)
  } else {
    console.log(`[auth] Member cache miss for user=${userId}`)
    memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, userId),
    })
    if (memberRecord) {
      setCachedMember(userId, memberRecord)
    }
  }

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
      id: userId,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image ?? null,
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
  const session = await getSessionDirect()
  if (!session?.user) {
    console.log(`[auth] Optional auth: no session`)
    return null
  }
  const userId = session.user.id as UserId
  console.log(`[auth] Optional auth: user=${userId}`)

  const appSettings = await getSettings()
  if (!appSettings) {
    return null
  }

  // Check member cache first
  let memberRecord = getCachedMember(userId)
  if (memberRecord) {
    console.log(`[auth] Member cache hit for user=${userId}`)
  } else {
    console.log(`[auth] Member cache miss for user=${userId}`)
    memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, userId),
    })

    // Auto-create member record for authenticated users without one
    if (!memberRecord) {
      console.log(`[auth] 📦 Creating member record for user=${userId}`)
      const newMemberId = generateId('member')
      const [created] = await db
        .insert(member)
        .values({
          id: newMemberId,
          userId,
          role: 'user',
          createdAt: new Date(),
        })
        .returning()
      memberRecord = created
      console.log(`[auth] ✅ Member created: id=${newMemberId}`)
    }

    // Cache the member (either found or just created)
    setCachedMember(userId, memberRecord)
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
    member: {
      id: memberRecord.id as MemberId,
      role: memberRecord.role as Role,
    },
  }
}
