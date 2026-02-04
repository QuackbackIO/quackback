#!/usr/bin/env bun
/**
 * @quackback/mcp - MCP Server for Quackback
 *
 * Entry point that validates configuration and starts the stdio server.
 *
 * Required environment variables:
 * - QUACKBACK_URL: Base URL of the Quackback instance (e.g., https://feedback.example.com)
 * - QUACKBACK_API_KEY: API key for authentication (Bearer token)
 *
 * Usage with Claude Desktop:
 * ```json
 * {
 *   "mcpServers": {
 *     "quackback": {
 *       "command": "bun",
 *       "args": ["run", "/path/to/packages/mcp/src/index.ts"],
 *       "env": {
 *         "QUACKBACK_URL": "https://feedback.example.com",
 *         "QUACKBACK_API_KEY": "qb_your_api_key_here"
 *       }
 *     }
 *   }
 * }
 * ```
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

// Fail-fast config validation
const url = process.env.QUACKBACK_URL
const apiKey = process.env.QUACKBACK_API_KEY

if (!url) {
  console.error('Error: QUACKBACK_URL environment variable is required')
  process.exit(1)
}

if (!apiKey) {
  console.error('Error: QUACKBACK_API_KEY environment variable is required')
  process.exit(1)
}

// Validate URL format
try {
  new URL(url)
} catch {
  console.error(`Error: QUACKBACK_URL is not a valid URL: ${url}`)
  process.exit(1)
}

// Create and start the server
const server = createServer({ url, apiKey })
const transport = new StdioServerTransport()
await server.connect(transport)
