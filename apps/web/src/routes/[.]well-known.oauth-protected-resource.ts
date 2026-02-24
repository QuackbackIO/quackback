/**
 * OAuth Protected Resource Metadata (RFC 9728)
 *
 * GET /.well-known/oauth-protected-resource
 *
 * Returns metadata about the MCP resource server, including
 * the authorization server URL for OAuth 2.1 discovery.
 * This is fetched by MCP clients (e.g., Claude Code) during
 * the OAuth discovery flow.
 */

import { createFileRoute } from '@tanstack/react-router'
import { config } from '@/lib/server/config'

export const Route = createFileRoute('/.well-known/oauth-protected-resource')({
  server: {
    handlers: {
      GET: async () => {
        const baseUrl = config.baseUrl

        return new Response(
          JSON.stringify({
            resource: `${baseUrl}/api/mcp`,
            authorization_servers: [baseUrl],
            bearer_methods_supported: ['header'],
            scopes_supported: [
              'openid',
              'profile',
              'email',
              'offline_access',
              'read:feedback',
              'write:feedback',
              'write:changelog',
            ],
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=3600',
            },
          }
        )
      },
    },
  },
})
