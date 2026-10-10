/**
 * Path-inserted RFC 8414 document for issuer `{origin}/api/auth`.
 *
 * MCP clients build this URL from `authorization_servers` and reject the
 * metadata when `issuer` is anything else. Same body as the root well-known
 * route.
 */

import { createFileRoute } from '@tanstack/react-router'

interface AuthWithOAuthServerConfig {
  api: { getOAuthServerConfig: (...args: never[]) => unknown }
}

export const Route = createFileRoute('/.well-known/oauth-authorization-server/api/auth')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getAuth } = await import('@/lib/server/auth/index')
        const { oauthProviderAuthServerMetadata } = await import('@better-auth/oauth-provider')
        const auth = await getAuth()
        const handler = oauthProviderAuthServerMetadata(
          auth as unknown as AuthWithOAuthServerConfig
        )
        return handler(request)
      },
    },
  },
})
