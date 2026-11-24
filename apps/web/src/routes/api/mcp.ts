/**
 * HTTP MCP Endpoint
 *
 * POST /api/mcp — handles JSON-RPC MCP messages
 * GET /api/mcp — 405: stateless serving offers no standalone event stream
 * DELETE /api/mcp — 405: there is no session to end
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
