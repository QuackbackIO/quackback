import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import { applyCatalogDiff } from '../discovery'
import { openConnectorSession } from '../mcp-client'
import { resolveToolPolicy, toolGroupFromAnnotations } from '@/lib/shared/assistant/connectors'

describe('connector MCP session (in-process transport)', () => {
  it('discovers tools, applies group defaults, and executes a read', async () => {
    const server = new McpServer({ name: 'fixture', version: '1.0.0' })
    // MCP SDK types against a different Zod copy than the workspace pin.
    const register = server.registerTool.bind(server) as (
      name: string,
      config: {
        title: string
        description: string
        inputSchema: Record<string, unknown>
        annotations: { readOnlyHint?: boolean; destructiveHint?: boolean }
      },
      handler: (args: {
        invoice_id: string
      }) => Promise<{ content: { type: 'text'; text: string }[] }>
    ) => void
    register(
      'get_invoice',
      {
        title: 'Get invoice',
        description: 'Look up an invoice',
        inputSchema: { invoice_id: z.string() },
        annotations: { readOnlyHint: true },
      },
      async ({ invoice_id }) => ({
        content: [{ type: 'text', text: JSON.stringify({ invoice_id, total: 49 }) }],
      })
    )
    register(
      'issue_refund',
      {
        title: 'Issue refund',
        description: 'Refund an invoice',
        inputSchema: { invoice_id: z.string() },
        annotations: { destructiveHint: true },
      },
      async () => ({
        content: [{ type: 'text', text: 'refunded' }],
      })
    )

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const session = await openConnectorSession({
      url: 'https://example.test/mcp',
      auth: { mode: 'none' },
      transport: clientTransport,
    })

    const discovered = await session.listTools()
    const diff = applyCatalogDiff([], discovered)
    expect(diff.tools.map((tool) => tool.name).sort()).toEqual(['get_invoice', 'issue_refund'])
    const read = diff.tools.find((tool) => tool.name === 'get_invoice')!
    const write = diff.tools.find((tool) => tool.name === 'issue_refund')!
    expect(toolGroupFromAnnotations(read.annotations)).toBe('read')
    expect(resolveToolPolicy(diff.toolPolicies, read.name, 'read')).toBe('always')
    expect(resolveToolPolicy(diff.toolPolicies, write.name, 'write')).toBe('approval')

    const result = await session.callTool('get_invoice', { invoice_id: 'INV-1' })
    expect(result.ok).toBe(true)
    expect(result.data).toContain('INV-1')

    await session.close()
    await server.close()
  })
})
