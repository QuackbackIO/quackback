/**
 * MCP Server setup for Quackback
 *
 * Creates and configures the McpServer with all tools and resources.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ApiConfig } from './api.js'
import { registerTools } from './tools.js'
import { registerResources } from './resources.js'

/**
 * Create a configured MCP server for Quackback.
 *
 * @param config - API configuration with URL and API key
 * @returns Configured McpServer instance
 */
export function createServer(config: ApiConfig): McpServer {
  const server = new McpServer({
    name: 'quackback-mcp',
    version: '0.1.0',
  })

  registerTools(server, config)
  registerResources(server, config)

  return server
}
