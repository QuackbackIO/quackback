import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createMcpServer } from '@/lib/server/mcp/server'
import type { McpAuthContext } from '@/lib/server/mcp/types'

export async function openAskSdkHarness(auth: McpAuthContext) {
  const server = createMcpServer(auth)
  const client = new Client({ name: 'quackback-admin-evaluation', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return {
    client,
    async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
      return (await client.callTool({ name, arguments: args })) as CallToolResult
    },
    async close() {
      await client.close()
      await server.close()
    },
  }
}

export function parseAskSdkResult(result: CallToolResult): Record<string, unknown> {
  const text = result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
  return JSON.parse(text) as Record<string, unknown>
}
