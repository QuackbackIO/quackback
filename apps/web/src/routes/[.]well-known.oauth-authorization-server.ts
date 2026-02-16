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
 * Note: Better Auth's oauthProvider plugin uses /api/auth as its
 * basePath, making the issuer `<origin>/api/auth`. RFC 8414 says
 * the metadata should live at `/.well-known/oauth-authorization-server/api/auth`,
 * but the official Better Auth demo serves it at the root well-known
 * path instead (see github.com/better-auth/better-auth #7453).
 * We follow the same pattern and silence the framework warning.
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
