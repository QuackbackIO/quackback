'use client'

import { createAuthClient } from 'better-auth/react'
import { customSessionClient } from 'better-auth/client/plugins'
import { ssoClient } from '@better-auth/sso/client'
import type { auth } from './index'

export const authClient = createAuthClient({
  plugins: [
    ssoClient(),
    // Custom session client for proper TypeScript inference of customSession fields
    customSessionClient<typeof auth>(),
  ],
})

export const { signIn, signOut, useSession } = authClient
