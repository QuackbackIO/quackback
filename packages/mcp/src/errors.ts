/**
 * Error classes and handling utilities for the MCP server
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * API error for HTTP errors (4xx, 5xx) from the Quackback REST API
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Auth error for 401/403 responses - these should propagate as MCP protocol errors
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * Wrapper for tool handlers that converts domain errors to tool results.
 * Auth errors (401/403) propagate as protocol errors so the MCP client sees them.
 * All other errors are returned as tool results so the LLM can see and handle them.
 */
export function withErrorHandling<T>(
  handler: (input: T) => Promise<CallToolResult>
): (input: T) => Promise<CallToolResult> {
  return async (input) => {
    try {
      return await handler(input)
    } catch (err) {
      // Auth errors propagate as protocol errors
      if (err instanceof AuthError) throw err

      // Domain errors returned as tool results so LLM can see them
      const message = err instanceof Error ? err.message : 'Unknown error'
      return {
        isError: true,
        content: [{ type: 'text', text: `Error: ${message}` }],
      }
    }
  }
}
