import { headers } from 'next/headers'
import { auth } from './index'
import { cache } from 'react'
import { db, user as userTable, eq } from '@quackback/db'

/**
 * Extended session user type with organizationId for tenant isolation
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
 * Get the current session with user including organizationId.
 *
 * Full Tenant Isolation: Users have organizationId directly on the user record.
 * This function extends Better-Auth's session with our custom user fields.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return null
  }

  // Fetch user with organizationId from our database
  const user = await db.query.user.findFirst({
    where: eq(userTable.id, session.user.id),
  })

  if (!user) {
    return null
  }

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
