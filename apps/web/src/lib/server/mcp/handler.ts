/**
 * MCP HTTP Request Handler
 *
 * Extracted from the route for testability.
 * Handles auth resolution, transport creation, and server lifecycle.
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { getDeveloperConfig } from '@/lib/server/domains/settings/settings.service'
import { db, member, eq } from '@/lib/server/db'
import { createMcpServer } from './server'
import type { McpAuthContext } from './types'

/** Resolve auth context from API key → member → user */
export async function resolveAuthContext(request: Request): Promise<McpAuthContext | Response> {
  const authResult = await withApiKeyAuth(request, { role: 'team' })
  if (authResult instanceof Response) return authResult

  const memberRecord = await db.query.member.findFirst({
    where: eq(member.id, authResult.memberId),
    with: { user: true },
  })

  if (!memberRecord?.user) {
    return new Response(JSON.stringify({ error: 'Member not found' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return {
    memberId: authResult.memberId,
    userId: memberRecord.user.id,
    name: memberRecord.user.name,
    email: memberRecord.user.email,
    role: authResult.role as 'admin' | 'member',
  }
}

/** Create a stateless transport + server, handle the request, clean up */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const config = await getDeveloperConfig()
  if (!config.mcpEnabled) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'MCP server is disabled. Enable it in Settings > Developers > MCP Server.',
        },
        id: null,
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const auth = await resolveAuthContext(request)
  if (auth instanceof Response) return auth

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  const server = createMcpServer(auth)
  await server.connect(transport)

  try {
    return await transport.handleRequest(request)
  } finally {
    await transport.close()
    await server.close()
  }
}
