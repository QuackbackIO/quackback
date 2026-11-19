/**
 * The stateless transport 2025-era MCP requests are served on (2026-07-28
 * requests go through the SDK's createMcpHandler instead), with its request
 * body cap set explicitly rather than left to the SDK default.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server'
import { MCP_MAX_REQUEST_BYTES } from './tools/files'

export function createMcpTransport(): WebStandardStreamableHTTPServerTransport {
  return new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MCP_MAX_REQUEST_BYTES,
  })
}
