/**
 * OAuth Protected Resource Metadata (RFC 9728)
 *
 * GET /.well-known/oauth-protected-resource
 *
 * First-connect scopes only. MCP clients that see a 401 without `scope=`
 * take all of `scopes_supported`; advertising writes + offline_access here
 * is what made Cursor's authorize request fail with `invalid_scope`.
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/.well-known/oauth-protected-resource')({
  server: {
    handlers: {
      GET: async () => {
        const { config } = await import('@/lib/server/config')
        const { mcpProtectedResourceResponse } =
          await import('@/lib/server/mcp/protected-resource-metadata')
        return mcpProtectedResourceResponse(config.baseUrl)
      },
    },
  },
})
