/**
 * Path-inserted RFC 9728 document for resource `…/api/mcp`.
 * Better Auth 1.7's challenge helper points here; keep it identical to the root PRM.
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/.well-known/oauth-protected-resource/api/mcp')({
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
