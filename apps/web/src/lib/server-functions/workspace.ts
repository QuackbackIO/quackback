/**
 * Server functions and utilities for workspace data fetching.
 *
 * Server Functions (createServerFn):
 * - getSettings: Fetch app settings
 * - getCurrentUserRole: Get current user's role
 * - validateApiWorkspaceAccess: Validate API access
 *
 * Route Utilities (regular async functions):
 * - requireWorkspace: Auth middleware (throws redirect)
 * - requireWorkspaceRole: Role-based auth middleware (throws redirect)
 */

import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { db, member, eq } from '@/lib/db'
import { getSession } from './auth'

/**
 * Get the app settings.
 * Returns the singleton settings record from the database.
 */
export const getSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const org = await db.query.settings.findFirst()
  return org ?? null
})

/**
 * Get current user's role if logged in
 */
export const getCurrentUserRole = createServerFn({ method: 'GET' }).handler(
  async (): Promise<'owner' | 'admin' | 'member' | 'user' | null> => {
    const session = await getSession()
    if (!session?.user) return null

    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id),
    })

    if (!memberRecord) return null
    return memberRecord.role as 'owner' | 'admin' | 'member' | 'user'
  }
)

/**
 * Require workspace access - throws redirect if invalid
 * IMPORTANT: Must be called from route loaders/beforeLoad, NOT from server functions
 */
export async function requireWorkspace() {
  const session = await getSession()
  if (!session?.user) {
    throw redirect({ to: '/' })
  }

  const appSettings = await db.query.settings.findFirst()
  if (!appSettings) {
    throw redirect({ to: '/' })
  }

  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id),
  })

  if (!memberRecord) {
    throw redirect({ to: '/' })
  }

  return {
    settings: appSettings,
    member: memberRecord,
    user: session.user,
  }
}

/**
 * Require specific workspace role - throws redirect if invalid
 * IMPORTANT: Must be called from route loaders/beforeLoad, NOT from server functions
 */
export async function requireWorkspaceRole(allowedRoles: string[]) {
  const result = await requireWorkspace()

  if (!allowedRoles.includes(result.member.role)) {
    throw redirect({ to: '/' })
  }

  return result
}

/**
 * Validate API workspace access
 */
export const validateApiWorkspaceAccess = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session?.user) {
    return { success: false as const, error: 'Unauthorized', status: 401 as const }
  }

  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id),
  })

  if (!memberRecord) {
    return { success: false as const, error: 'Forbidden', status: 403 as const }
  }

  const appSettings = await db.query.settings.findFirst()
  if (!appSettings) {
    return { success: false as const, error: 'Settings not found', status: 403 as const }
  }

  return {
    success: true as const,
    settings: appSettings,
    member: memberRecord,
    user: session.user,
  }
})

export type ApiWorkspaceResult = Awaited<ReturnType<typeof validateApiWorkspaceAccess>>
