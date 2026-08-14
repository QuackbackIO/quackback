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
import { safeFetch } from '@/lib/server/content/ssrf-guard'

const log = logger.child({ component: 'assistant-connectors-mcp' })

/** Hard ceiling for connect + listTools / callTool. */
export const CONNECTOR_REQUEST_TIMEOUT_MS = 15_000
const MAX_CONNECTOR_RESPONSE_BYTES = 256 * 1024
const MAX_CONNECTOR_TOOLS = 64
const MAX_TOOL_SCHEMA_CHARS = 8_192
const MAX_CONNECTOR_RESULT_CHARS = 32_768

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

async function connectorFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init)
  const parsed = new URL(request.url)
  if (parsed.username || parsed.password) {
    throw new Error('Connector URL must not include credentials')
  }

  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const body = request.body ? await request.text() : undefined
  return safeFetch(request.url, {
    method: request.method,
    headers,
    body,
    timeoutMs: CONNECTOR_REQUEST_TIMEOUT_MS,
    maxResponseBytes: MAX_CONNECTOR_RESPONSE_BYTES,
    onOverflow: 'truncate',
  })
}

function capJsonValue(value: unknown, maxChars: number): { data: unknown; truncated: boolean } {
  if (value === undefined) return { data: value, truncated: false }
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length <= maxChars) return { data: value, truncated: false }
  return { data: text.slice(0, maxChars), truncated: true }
}

async function withMcpClient<T>(
  endpoint: ConnectorMcpEndpoint,
  run: (client: Client) => Promise<T>
): Promise<T> {
  return withTimeout(async () => {
    const headers: Record<string, string> = {}
    if (endpoint.authToken) headers.Authorization = `Bearer ${endpoint.authToken}`

    const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers },
      fetch: connectorFetch,
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
    const tools = (result.tools ?? []).slice(0, MAX_CONNECTOR_TOOLS)
    if ((result.tools ?? []).length > MAX_CONNECTOR_TOOLS) {
      log.warn(
        { kept: MAX_CONNECTOR_TOOLS, total: result.tools?.length },
        'connector tools/list truncated'
      )
    }
    return tools.map((tool) => {
      const schema = JSON.stringify(
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema
          : { type: 'object', properties: {} }
      )
      return {
        name: tool.name,
        description: (tool.description ?? '').slice(0, 500),
        inputSchemaJson:
          schema.length > MAX_TOOL_SCHEMA_CHARS
            ? JSON.stringify({ type: 'object', properties: {} })
            : schema,
      }
    })
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
      const capped = capJsonValue(structured, MAX_CONNECTOR_RESULT_CHARS)
      return {
        ok: !isError,
        data: capped.data,
        note: isError
          ? 'Tool reported an error'
          : capped.truncated
            ? 'Connector result truncated'
            : undefined,
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
    const uncapped = texts.length === 1 ? texts[0] : texts
    const capped = capJsonValue(uncapped, MAX_CONNECTOR_RESULT_CHARS)
    return {
      ok: !isError,
      data: capped.data,
      note: isError
        ? 'Tool reported an error'
        : capped.truncated
          ? 'Connector result truncated'
          : undefined,
    }
  })
}
