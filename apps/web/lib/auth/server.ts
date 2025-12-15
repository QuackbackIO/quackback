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
  image: string | null
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

  // Cast to include organizationId from additionalFields and image from customSession
  const user = session.user as typeof session.user & { organizationId: string }

  return {
    session: session.session,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      organizationId: user.organizationId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
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
