/**
 * Auth and access utilities
 *
 * Handles authentication and authorization for the application.
 */

import { cache } from 'react'
import { redirect } from '@tanstack/react-router'
import { db, member, eq, type Database } from '@/lib/db'
import { getSession } from './auth/server'
import type { UserId } from '@quackback/ids'

// =============================================================================
// Settings Resolution
// =============================================================================

/**
 * Get the app settings.
 * Returns the singleton settings record from the database.
 */
export const getSettings = cache(async () => {
  const org = await db.query.settings.findFirst()
  return org ?? null
})

// =============================================================================
// Member Lookup (simplified - member table is the source of truth)
// =============================================================================

/**
 * Get member record for a user.
 *
 * All authenticated users have member records with unified roles:
 * - owner/admin/member: Team members with admin dashboard access
 * - user: Portal users with public portal access only
 */
async function getMemberRecord(userId: UserId): Promise<typeof member.$inferSelect | null> {
  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, userId),
  })
  return memberRecord ?? null
}

/**
 * Get the current user's role if logged in.
 * Returns null if not logged in or no member record.
 *
 * Use this for public pages that want to show different UI based on role
 * (e.g., "Admin" button vs "Log in" button).
 *
 * All authenticated users have member records with unified roles:
 * - owner/admin/member: Can access admin dashboard
 * - user: Portal users (public portal only)
 */
export const getCurrentUserRole = cache(
  async (): Promise<'owner' | 'admin' | 'member' | 'user' | null> => {
    const session = await getSession()

    if (!session?.user) {
      return null
    }

    const memberRecord = await getMemberRecord(session.user.id)

    if (!memberRecord) {
      return null
    }

    return memberRecord.role as 'owner' | 'admin' | 'member' | 'user'
  }
)

// =============================================================================
// Access Validation
// =============================================================================

type ValidationResult =
  | { valid: false; reason: 'not_authenticated' | 'settings_not_found' | 'no_access' }
  | {
      valid: true
      settings: NonNullable<Awaited<ReturnType<typeof getSettings>>>
      member: NonNullable<Awaited<ReturnType<typeof db.query.member.findFirst>>>
      user: NonNullable<Awaited<ReturnType<typeof getSession>>>['user']
    }

/**
 * Validate that the current user has access to the workspace.
 *
 * Access = has a member record (any role: owner/admin/member/user).
 * Returns the settings and member info if valid.
 */
export const validateWorkspaceAccess = cache(async (): Promise<ValidationResult> => {
  const [session, appSettings] = await Promise.all([getSession(), getSettings()])

  if (!session?.user) {
    return { valid: false, reason: 'not_authenticated' }
  }

  if (!appSettings) {
    return { valid: false, reason: 'settings_not_found' }
  }

  // Check member table for access
  const memberRecord = await getMemberRecord(session.user.id)

  if (!memberRecord) {
    return { valid: false, reason: 'no_access' }
  }

  return {
    valid: true,
    settings: appSettings,
    member: memberRecord,
    user: session.user,
  }
})

// =============================================================================
// Access Guards (redirect on failure)
// =============================================================================

/**
 * Require valid workspace access - redirects if invalid.
 */
export async function requireWorkspace() {
  const result = await validateWorkspaceAccess()

  if (!result.valid) {
    const redirectMap = {
      not_authenticated: '/login',
      settings_not_found: '/login?error=settings_not_found',
      no_access: '/login?error=no_access',
    } as const
    throw redirect({ to: redirectMap[result.reason] as any })
  }

  return result
}

/**
 * Require specific role.
 * Redirects to portal home if user doesn't have required role.
 */
export async function requireWorkspaceRole(allowedRoles: string[]) {
  const result = await requireWorkspace()

  if (!allowedRoles.includes(result.member.role)) {
    // Users without required role get redirected to portal home
    throw redirect({ to: '/' })
  }

  return result
}

// =============================================================================
// Workspace Database Access
// =============================================================================

/**
 * Context provided to authenticated workspace callbacks
 */
export interface AuthenticatedWorkspaceContext {
  settings: NonNullable<Awaited<ReturnType<typeof getSettings>>>
  member: NonNullable<Awaited<ReturnType<typeof db.query.member.findFirst>>>
  user: NonNullable<Awaited<ReturnType<typeof getSession>>>['user']
  db: Database
}

/**
 * Execute database operations with authenticated workspace context.
 *
 * This wrapper:
 * 1. Validates user authentication
 * 2. Provides the database connection
 * 3. Executes your callback
 *
 * @example
 * const posts = await withAuthenticatedWorkspace(async ({ db, member }) => {
 *   return db.query.posts.findMany({
 *     where: eq(posts.status, 'open'),
 *   })
 * })
 */
export async function withAuthenticatedWorkspace<T>(
  callback: (ctx: AuthenticatedWorkspaceContext) => Promise<T>
): Promise<T> {
  const result = await validateWorkspaceAccess()

  if (!result.valid) {
    const errorMessages = {
      not_authenticated: 'Authentication required',
      settings_not_found: 'Settings not found',
      no_access: 'Access denied',
    } as const
    throw new Error(errorMessages[result.reason])
  }

  return callback({
    settings: result.settings,
    member: result.member,
    user: result.user,
    db,
  })
}

/**
 * Get authenticated workspace context with database access wrapper.
 * Redirects to login on auth failure (for use in server components).
 *
 * @example
 * // In a server component
 * const { settings, withDb } = await requireAuthenticatedWorkspace()
 * const posts = await withDb(db => db.query.posts.findMany())
 */
export async function requireAuthenticatedWorkspace(): Promise<
  Omit<AuthenticatedWorkspaceContext, 'db'> & {
    /** @deprecated Use withDb instead */
    withRLS: <T>(fn: (db: Database) => Promise<T>) => Promise<T>
    withDb: <T>(fn: (db: Database) => Promise<T>) => Promise<T>
  }
> {
  const result = await requireWorkspace() // This already redirects on failure

  const withDb = <T>(fn: (db: Database) => Promise<T>) => fn(db)

  return {
    settings: result.settings,
    member: result.member,
    user: result.user,
    withRLS: withDb, // @deprecated alias
    withDb,
  }
}

// =============================================================================
// API Route Helpers
// =============================================================================

/**
 * Result type for API validation
 */
export type ApiWorkspaceResult =
  | { success: false; error: string; status: 401 | 403 }
  | {
      success: true
      settings: NonNullable<Awaited<ReturnType<typeof db.query.settings.findFirst>>>
      member: NonNullable<Awaited<ReturnType<typeof db.query.member.findFirst>>>
      user: NonNullable<Awaited<ReturnType<typeof getSession>>>['user']
    }

/**
 * Validate access for API routes.
 *
 * Access = has a member record (any role: owner/admin/member/user).
 *
 * @returns Validation result with settings, member, and user if successful
 *
 * @example
 * const validation = await validateApiWorkspaceAccess()
 * if (!validation.success) {
 *   return NextResponse.json({ error: validation.error }, { status: validation.status })
 * }
 * const { settings, member, user } = validation
 */
export async function validateApiWorkspaceAccess(): Promise<ApiWorkspaceResult> {
  const session = await getSession()
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', status: 401 }
  }

  // Check member table for access
  const memberRecord = await getMemberRecord(session.user.id)

  if (!memberRecord) {
    return { success: false, error: 'Forbidden', status: 403 }
  }

  // Get the settings
  const appSettings = await getSettings()

  if (!appSettings) {
    return { success: false, error: 'Settings not found', status: 403 }
  }

  return {
    success: true,
    settings: appSettings,
    member: memberRecord,
    user: session.user,
  }
}

/**
 * Execute database operations with authenticated workspace context for API routes.
 *
 * @example
 * const result = await withApiWorkspaceContext(async ({ db, member }) => {
 *   return db.query.posts.findMany()
 * })
 * if (!result.success) {
 *   return NextResponse.json({ error: result.error }, { status: result.status })
 * }
 * return NextResponse.json(result.data)
 */
type ApiWorkspaceSuccessResult = Extract<ApiWorkspaceResult, { success: true }>

export async function withApiWorkspaceContext<T>(
  callback: (ctx: AuthenticatedWorkspaceContext) => Promise<T>
): Promise<
  | { success: false; error: string; status: 401 | 403 }
  | {
      success: true
      data: T
      settings: ApiWorkspaceSuccessResult['settings']
      member: ApiWorkspaceSuccessResult['member']
      user: ApiWorkspaceSuccessResult['user']
    }
> {
  const validation = await validateApiWorkspaceAccess()

  if (!validation.success) {
    return validation
  }

  const data = await callback({
    settings: validation.settings,
    member: validation.member,
    user: validation.user,
    db,
  })

  return {
    success: true,
    data,
    settings: validation.settings,
    member: validation.member,
    user: validation.user,
  }
}
