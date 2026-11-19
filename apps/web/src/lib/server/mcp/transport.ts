/**
 * The stateless MCP transport every request is served on, with its request
 * body cap set explicitly rather than left to the SDK default.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { MCP_MAX_REQUEST_BYTES } from './tools/files'

export function createMcpTransport(): WebStandardStreamableHTTPServerTransport {
  return new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MCP_MAX_REQUEST_BYTES,
  })
}
