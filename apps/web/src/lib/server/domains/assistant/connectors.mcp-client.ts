/**
 * Outbound MCP client for Quinn Connectors.
 *
 * Dials a remote MCP server over Streamable HTTP, lists tools, and calls them.
 * Kept separate from Quackback's inbound MCP server (`lib/server/mcp`).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { StoredConnectorTool } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-connectors-mcp' })

/** Hard ceiling for connect + listTools / callTool. */
export const CONNECTOR_REQUEST_TIMEOUT_MS = 15_000

export interface ConnectorMcpEndpoint {
  url: string
  /** Plaintext bearer token, if any. */
  authToken?: string | null
}

class ConnectorTimeoutError extends Error {
  constructor() {
    super('Connector request timed out')
    this.name = 'ConnectorTimeoutError'
  }
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new ConnectorTimeoutError())
      controller.signal.addEventListener('abort', onAbort, { once: true })
      void run(controller.signal).then(resolve, reject)
    })
  } finally {
    clearTimeout(timer)
  }
}

async function withMcpClient<T>(
  endpoint: ConnectorMcpEndpoint,
  run: (client: Client) => Promise<T>
): Promise<T> {
  return withTimeout(async (signal) => {
    const headers: Record<string, string> = {}
    if (endpoint.authToken) headers.Authorization = `Bearer ${endpoint.authToken}`

    const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers, signal },
    })
    const client = new Client({ name: 'quackback', version: '1.0.0' }, { capabilities: {} })
    try {
      await client.connect(transport)
      return await run(client)
    } finally {
      try {
        await client.close()
      } catch (error) {
        log.warn({ err: error }, 'failed to close MCP connector client')
      }
    }
  }, CONNECTOR_REQUEST_TIMEOUT_MS)
}

/** Fetch the remote tools/list catalogue. */
export async function listRemoteConnectorTools(
  endpoint: ConnectorMcpEndpoint
): Promise<StoredConnectorTool[]> {
  return withMcpClient(endpoint, async (client) => {
    const result = await client.listTools()
    return (result.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchemaJson: JSON.stringify(
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema
          : { type: 'object', properties: {} }
      ),
    }))
  })
}

/** Invoke one remote MCP tool and return a JSON-serializable result. */
export async function callRemoteConnectorTool(
  endpoint: ConnectorMcpEndpoint,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; note?: string }> {
  return withMcpClient(endpoint, async (client) => {
    const result = await client.callTool({ name: toolName, arguments: args })
    const isError = result.isError === true
    // Prefer structuredContent when present; otherwise flatten content blocks.
    const structured = (result as { structuredContent?: unknown }).structuredContent
    if (structured !== undefined) {
      return {
        ok: !isError,
        data: structured,
        note: isError ? 'Tool reported an error' : undefined,
      }
    }
    const content = Array.isArray(result.content) ? result.content : []
    const texts = content
      .map((block) => {
        if (block && typeof block === 'object' && 'type' in block && block.type === 'text') {
          return typeof (block as { text?: unknown }).text === 'string'
            ? (block as { text: string }).text
            : ''
        }
        return ''
      })
      .filter(Boolean)
    return {
      ok: !isError,
      data: texts.length === 1 ? texts[0] : texts,
      note: isError ? 'Tool reported an error' : undefined,
    }
  })
}
