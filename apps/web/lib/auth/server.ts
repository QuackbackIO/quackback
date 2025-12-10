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
      createdAt: session.user.createdAt,
      updatedAt: session.user.updatedAt,
    },
  }
})

export const getActiveOrganization = cache(async () => {
  const org = await auth.api.getFullOrganization({
    headers: await headers(),
  })
  return org
})

export async function requireAuth() {
  const session = await getSession()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }
  return session
}

export async function requireOrganization() {
  const session = await requireAuth()
  const org = await getActiveOrganization()

  if (!org) {
    throw new Error('No active organization')
  }

  return { session, organization: org }
}

export async function requireRole(allowedRoles: string[]) {
  const { session, organization } = await requireOrganization()

  const member = organization.members.find((m) => m.userId === session.user.id)

  if (!member || !allowedRoles.includes(member.role)) {
    throw new Error('Forbidden')
  }

  return { session, organization, member }
}
