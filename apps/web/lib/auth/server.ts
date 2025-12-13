import { headers } from 'next/headers'
import { auth } from './index'
import { cache } from 'react'

/**
 * Session user type aligned with Better-Auth
 *
 * Users are scoped to organizations. Each user belongs to exactly one org.
 * Organization access is determined by member table with unified roles:
 * - owner/admin/member: Team members with admin dashboard access
 * - user: Portal users with public portal access only
 */
export interface SessionUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string | null
  organizationId: string
  createdAt: Date
  updatedAt: Date
}

export interface Session {
  session: {
    id: string
    expiresAt: Date
    token: string
    createdAt: Date
    updatedAt: Date
    userId: string
  }
  user: SessionUser
}

/**
 * Get the current session with user.
 *
 * Users are scoped to organizations. To check organization access:
 * - Query member table for the user's role (owner/admin/member/user)
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return null
  }

  return {
    session: session.session,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      image: session.user.image,
      organizationId: session.user.organizationId,
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
