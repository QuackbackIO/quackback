/**
 * Trust Login Plugin for Better-Auth
 *
 * This plugin provides cross-domain session transfer for Cloud edition.
 * In OSS edition, this endpoint returns an error since there's no external
 * auth flow to transfer sessions from.
 *
 * Cloud flow (handled by website):
 * 1. User authenticates on main domain
 * 2. Website creates transfer token and redirects to tenant subdomain
 * 3. Tenant app validates token and creates local session
 *
 * OSS mode:
 * - Users authenticate directly with the app
 * - No transfer tokens needed
 */

import { createAuthEndpoint } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth'
import { z } from 'zod'

export const trustLogin = () => {
  return {
    id: 'trust-login',
    endpoints: {
      trustLogin: createAuthEndpoint(
        '/trust-login',
        {
          method: 'GET',
          query: z.object({
            token: z.string(),
          }),
        },
        async (ctx) => {
          // In OSS mode, trust-login is not supported
          // Users should authenticate directly via the login page
          return ctx.redirect('/login?error=trust_login_not_supported')
        }
      ),
    },
  } satisfies BetterAuthPlugin
}
