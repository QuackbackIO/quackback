/**
 * Outbound MCP client for one connector.
 *
 * Transport is streamable HTTP with DNS-pinned fetch. Discovery and tool
 * calls go through the official MCP client; Quinn never spreads raw
 * discovered tools into the agent loop — those become AssistantToolSpecs
 * in connector-tools.ts.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { safePinnedFetch } from '@/lib/server/content/ssrf-guard'
import { logger } from '@/lib/server/logger'
import {
  CONNECTOR_MAX_RESPONSE_BYTES,
  CONNECTOR_REQUEST_TIMEOUT_MS,
  CONNECTOR_RESPONSE_CHAR_LIMIT,
} from '@/lib/shared/assistant/connectors'
import { capSerializedResponse } from './cap-response'

const log = logger.child({ component: 'assistant-connectors-mcp' })

export interface ConnectorMcpAuth {
  mode: 'none' | 'bearer' | 'oauth'
  bearerToken?: string
  accessToken?: string
}

export interface DiscoveredMcpTool {
  name: string
  title?: string
  description?: string
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean }
  inputSchema?: Record<string, unknown>
}

export interface ConnectorMcpSession {
  listTools(): Promise<DiscoveredMcpTool[]>
  callTool(name: string, args: Record<string, unknown>): Promise<ConnectorToolCallResult>
  close(): Promise<void>
}

export interface ConnectorToolCallResult {
  ok: boolean
  data: string
  note?: string
}

export function serializeConnectorResult(value: unknown): ConnectorToolCallResult {
  const payload =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : { result: value }
  const { data, truncated } = capSerializedResponse(payload, CONNECTOR_RESPONSE_CHAR_LIMIT)
  return {
    ok: true,
    data,
    note: truncated ? 'Result was truncated.' : undefined,
  }
}

function authHeaders(auth: ConnectorMcpAuth): Record<string, string> {
  const token =
    auth.mode === 'bearer' ? auth.bearerToken : auth.mode === 'oauth' ? auth.accessToken : undefined
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

export async function openConnectorSession(input: {
  url: string
  auth: ConnectorMcpAuth
  authProvider?: OAuthClientProvider
  transport?: Transport
}): Promise<ConnectorMcpSession> {
  const client = new Client({ name: 'quackback-connectors', version: '1.0.0' })
  const transport =
    input.transport ??
    new StreamableHTTPClientTransport(new URL(input.url), {
      requestInit: { headers: authHeaders(input.auth) },
      fetch: safePinnedFetch,
      authProvider: input.authProvider,
    })
  await client.connect(transport)

  return {
    async listTools() {
      const listed = await client.listTools()
      return listed.tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint === true,
          destructiveHint: tool.annotations?.destructiveHint === true,
        },
        inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
      }))
    },
    async callTool(name, args) {
      try {
        const result = await client.callTool({ name, arguments: args }, undefined, {
          timeout: CONNECTOR_REQUEST_TIMEOUT_MS,
          maxTotalTimeout: CONNECTOR_REQUEST_TIMEOUT_MS,
        })
        if (result.isError) {
          const text = extractResultText(result as { content?: unknown })
          return { ok: false, data: '', note: text || 'The remote tool returned an error.' }
        }
        return serializeConnectorResult({
          content: result.content,
          structured: result.structuredContent ?? undefined,
        })
      } catch (err) {
        log.warn({ err, tool: name }, 'connector tool call failed')
        return {
          ok: false,
          data: '',
          note: 'The remote tool could not be reached. Try again or ask a teammate.',
        }
      }
    },
    async close() {
      try {
        await client.close()
      } catch (err) {
        log.warn({ err }, 'connector client close failed')
      }
    },
  }
}

function extractResultText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return ''
  return result.content
    .map((part) => {
      if (
        part &&
        typeof part === 'object' &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part
      ) {
        return String(part.text)
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, CONNECTOR_MAX_RESPONSE_BYTES)
}

export { CONNECTOR_MAX_RESPONSE_BYTES, CONNECTOR_REQUEST_TIMEOUT_MS }
