/**
 * Server functions for workspace data fetching.
 *
 * Server Functions (createServerFn):
 * - getSettings: Fetch app settings
 * - getCurrentUserRole: Get current user's role
 * - validateApiWorkspaceAccess: Validate API access
 *
 * NOTE: All DB and server-only imports are done dynamically inside handlers
 * to prevent client bundling issues with TanStack Start.
 *
 * See also: workspace-utils.ts for requireWorkspace and requireWorkspaceRole.
 */

import { createServerFn } from '@tanstack/react-start'

/**
 * Get the app settings.
 * Returns the singleton settings record from the database.
 */
export const getSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const { db } = await import('@/lib/db')

  const org = await db.query.settings.findFirst()
  return org ?? null
})

/**
 * Get current user's role if logged in
 */
export const getCurrentUserRole = createServerFn({ method: 'GET' }).handler(
  async (): Promise<'owner' | 'admin' | 'member' | 'user' | null> => {
    const { getSession } = await import('./auth')
    const { db, member, eq } = await import('@/lib/db')

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
 * Validate API workspace access
 */
export const validateApiWorkspaceAccess = createServerFn({ method: 'GET' }).handler(async () => {
  const { getSession } = await import('./auth')
  const { db, member, eq } = await import('@/lib/db')

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
