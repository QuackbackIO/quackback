import { describe, it, expect } from 'vitest'
import { createServer } from './server.js'

describe('createServer', () => {
  it('should create an MCP server with tools and resources', () => {
    const server = createServer({
      url: 'https://example.com',
      apiKey: 'test_key',
    })

    // McpServer wraps the underlying Server
    expect(server).toBeDefined()
    expect(server.server).toBeDefined()
    // The server has the implementation info
    expect(typeof server.connect).toBe('function')
    expect(typeof server.close).toBe('function')
  })
})
