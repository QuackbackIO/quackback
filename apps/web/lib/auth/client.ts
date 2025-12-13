'use client'

import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'
import { ssoClient } from '@better-auth/sso/client'

export const authClient = createAuthClient({
  plugins: [organizationClient(), ssoClient()],
})

export const { signIn, signOut, useSession } = authClient

export const { acceptInvitation } = authClient.organization
