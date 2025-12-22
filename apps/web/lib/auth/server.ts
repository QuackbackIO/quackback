import { headers } from 'next/headers'
import { auth } from './index'
import { cache } from 'react'
import type { UserId, SessionId } from '@quackback/ids'

/**
 * Session user type with TypeID types
 *
 * Users are scoped to organizations. Each user belongs to exactly one org.
 * Organization access is determined by member table with unified roles:
 * - owner/admin/member: Team members with admin dashboard access
 * - user: Portal users with public portal access only
 */
export interface SessionUser {
  id: UserId
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Session {
  session: {
    id: SessionId
    expiresAt: Date
    token: string
    createdAt: Date
    updatedAt: Date
    userId: UserId
  }
  user: SessionUser
}

/**
 * Get the current session with user.
 *
 * Returns session with properly typed IDs (UserId, WorkspaceId, SessionId).
 * The database stores UUIDs but the schema layer returns TypeID format.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return null
  }

  // Better-auth returns raw data from our schema, which already provides TypeID format
  // We cast to our typed interfaces for TypeScript awareness
  return {
    session: {
      id: session.session.id as SessionId,
      expiresAt: session.session.expiresAt,
      token: session.session.token,
      createdAt: session.session.createdAt,
      updatedAt: session.session.updatedAt,
      userId: session.session.userId as UserId,
    },
    user: {
      id: session.user.id as UserId,
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      image: session.user.image,
      createdAt: session.user.createdAt,
      updatedAt: session.user.updatedAt,
    },
  }
})

export async function requireAuth() {
  const session = await getSession()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }
  return session
}
