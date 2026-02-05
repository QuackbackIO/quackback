/**
 * HTTP MCP Endpoint
 *
 * POST /api/mcp — handles JSON-RPC MCP messages
 * GET /api/mcp — handled by transport (no-op in stateless mode)
 * DELETE /api/mcp — handled by transport (no-op in stateless mode)
 *
 * Stateless: one transport + server per request. No session management.
 */

import { createFileRoute } from '@tanstack/react-router'
import { handleMcpRequest } from '@/lib/server/mcp/handler'

export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      POST: async ({ request }) => handleMcpRequest(request),
      GET: async ({ request }) => handleMcpRequest(request),
      DELETE: async ({ request }) => handleMcpRequest(request),
    },
  },
})
