/**
 * Auth helper functions for inline use in server functions.
 * These replace the auth-middleware.ts wrappers with simpler, inline checks.
 */

import { getSession } from '@/lib/server-functions/auth'
import { getSettings } from '@/lib/server-functions/workspace'
import { db, member, eq } from '@/lib/db'
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
  }
  member: {
    id: MemberId
    role: Role
  }
}

export interface PartialAuthContext {
  settings: {
    id: WorkspaceId
    slug: string
    name: string
  }
  user: null
  member: null
}

/**
 * Get auth context for authenticated requests.
 * Throws if user is not authenticated or not a team member.
 */
export async function requireAuth(options?: { roles?: Role[] }): Promise<AuthContext> {
  const session = await getSession()
  if (!session?.user) {
    throw new Error('Authentication required')
  }

  const appSettings = await getSettings()
  if (!appSettings) {
    throw new Error('Workspace settings not found')
  }

  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id as UserId),
  })
  if (!memberRecord) {
    throw new Error('Access denied: Member record not found')
  }

  if (options?.roles && !options.roles.includes(memberRecord.role as Role)) {
    throw new Error(
      `Access denied: Requires one of [${options.roles.join(', ')}], got ${memberRecord.role}`
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
    },
    member: {
      id: memberRecord.id as MemberId,
      role: memberRecord.role as Role,
    },
  }
}

/**
 * Get auth context for requests that allow unauthenticated access.
 * Returns partial context with null user/member if not authenticated.
 */
export async function getOptionalAuth(): Promise<AuthContext | PartialAuthContext> {
  const session = await getSession()
  const appSettings = await getSettings()
  if (!appSettings) {
    throw new Error('Workspace settings not found')
  }

  if (!session?.user) {
    return {
      settings: {
        id: appSettings.id as WorkspaceId,
        slug: appSettings.slug,
        name: appSettings.name,
      },
      user: null,
      member: null,
    }
  }

  const memberRecord = await db.query.member.findFirst({
    where: eq(member.userId, session.user.id as UserId),
  })

  if (!memberRecord) {
    return {
      settings: {
        id: appSettings.id as WorkspaceId,
        slug: appSettings.slug,
        name: appSettings.name,
      },
      user: null,
      member: null,
    }
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
    },
    member: {
      id: memberRecord.id as MemberId,
      role: memberRecord.role as Role,
    },
  }
}
