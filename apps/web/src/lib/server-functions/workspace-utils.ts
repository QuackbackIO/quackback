/**
 * Workspace utility server functions for route loaders.
 *
 * These are createServerFn wrappers that can throw redirects.
 * Using createServerFn ensures TanStack Start properly handles
 * the server/client code separation at build time.
 */

import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { z } from 'zod'

/**
 * Require workspace access - throws redirect if invalid
 */
export const requireWorkspace = createServerFn({ method: 'GET' }).handler(async () => {
  const { getSession } = await import('./auth')
  const { db, member, eq } = await import('@/lib/db')

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
})

const requireWorkspaceRoleSchema = z.object({
  allowedRoles: z.array(z.string()),
})

/**
 * Require specific workspace role - throws redirect if invalid
 */
export const requireWorkspaceRole = createServerFn({ method: 'GET' })
  .inputValidator(requireWorkspaceRoleSchema)
  .handler(async ({ data }) => {
    const result = await requireWorkspace()

    if (!data.allowedRoles.includes(result.member.role)) {
      throw redirect({ to: '/' })
    }

    return result
  })
