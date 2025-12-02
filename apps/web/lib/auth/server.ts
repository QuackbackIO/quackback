import { headers } from 'next/headers'
import { auth } from './index'
import { cache } from 'react'

export const getSession = cache(async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  return session
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

  const member = organization.members.find(
    (m) => m.userId === session.user.id
  )

  if (!member || !allowedRoles.includes(member.role)) {
    throw new Error('Forbidden')
  }

  return { session, organization, member }
}
