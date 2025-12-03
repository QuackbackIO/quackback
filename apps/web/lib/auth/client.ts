'use client'

import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'
import { ssoClient } from '@better-auth/sso/client'

export const authClient = createAuthClient({
  plugins: [organizationClient(), ssoClient()],
})

export const { signIn, signUp, useSession } = authClient

/**
 * Sign out using a simple relative fetch (works on any subdomain)
 */
export async function signOut() {
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' })
  window.location.href = '/'
}

export const {
  create: createOrganization,
  setActive: setActiveOrganization,
  list: listOrganizations,
  getFullOrganization,
  inviteMember,
  removeMember,
  updateMemberRole,
  acceptInvitation,
  rejectInvitation,
} = authClient.organization

// SSO client methods for enterprise authentication
export const sso = authClient.sso
