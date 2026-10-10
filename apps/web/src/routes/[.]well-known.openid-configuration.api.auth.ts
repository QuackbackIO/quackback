/**
 * Path-inserted OpenID Connect discovery for issuer `{origin}/api/auth`.
 *
 * The MCP authorization spec has clients try, for an issuer with a path,
 * the RFC 8414 path-inserted URL, then this one, then the appended
 * `/api/auth/.well-known/openid-configuration`. Same body as the root route.
 */

import { createFileRoute } from '@tanstack/react-router'

interface AuthWithOpenIdConfig {
  api: { getOpenIdConfig: (...args: never[]) => unknown }
}

export const Route = createFileRoute('/.well-known/openid-configuration/api/auth')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getAuth } = await import('@/lib/server/auth/index')
        const { oauthProviderOpenIdConfigMetadata } = await import('@better-auth/oauth-provider')
        const auth = await getAuth()
        const handler = oauthProviderOpenIdConfigMetadata(auth as unknown as AuthWithOpenIdConfig)
        return handler(request)
      },
    },
  },
})
