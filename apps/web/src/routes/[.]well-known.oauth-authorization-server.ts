/**
 * OAuth Authorization Server Metadata (RFC 8414)
 *
 * GET /.well-known/oauth-authorization-server
 *
 * Returns metadata about the OAuth 2.1 authorization server,
 * including supported grant types, endpoints, and scopes.
 * This is fetched by MCP clients (e.g., Claude Code) during
 * the OAuth discovery flow.
 *
 * The issuer is `<origin>/api/auth`. RFC 8414 puts that document at
 * `/.well-known/oauth-authorization-server/api/auth` (see the sibling route).
 * This root URL stays so clients that still request it receive the same
 * metadata body.
 */

import { createFileRoute } from '@tanstack/react-router'

interface AuthWithOAuthServerConfig {
  api: { getOAuthServerConfig: (...args: never[]) => unknown }
}

export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getAuth } = await import('@/lib/server/auth/index')
        const { oauthProviderAuthServerMetadata } = await import('@better-auth/oauth-provider')
        const auth = await getAuth()
        // Plugin-added API methods aren't visible in the static type from getAuth()
        const handler = oauthProviderAuthServerMetadata(
          auth as unknown as AuthWithOAuthServerConfig
        )
        return handler(request)
      },
    },
  },
})
