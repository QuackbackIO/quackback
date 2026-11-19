/**
 * One log line per MCP request, so a client that connects and then behaves
 * oddly can be diagnosed from the logs alone: which JSON-RPC methods it sent,
 * which protocol revision it spoke, who it said it was, and why a call failed.
 *
 * It records names and outcomes only. Never tool arguments, results, tokens or
 * request bodies: those can hold customer text and credentials.
 */
import { logger } from '@/lib/server/logger'

/** The `_meta` key a 2026-07-28 client identifies itself with on every request. */
const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo'
/** The `_meta` key a 2026-07-28 client names its protocol revision with. */
const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion'

/** Longest error message kept, so a verbose failure cannot flood the line. */
const MAX_ERROR_LENGTH = 300

export interface McpRequestSummary {
  /** JSON-RPC methods in the body, in order (a batch lists several). */
  methods: string[]
  /** `params.name` of each `tools/call`. */
  tools: string[]
  /** The revision the client asked for: header, 2026 `_meta`, or `initialize` params. */
  protocolVersion?: string
  /** The `Mcp-Method` header a 2026-07-28 client sends. */
  mcpMethodHeader?: string
  clientName?: string
  clientVersion?: string
  userAgent?: string
  /** Set once auth resolves. */
  authMethod?: 'oauth' | 'api-key'
  /** The OAuth client id or API key id the request arrived through, once auth resolves. */
  credentialId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read what the request says about itself. Reads a clone, so the body stays
 * available to the transport. A body that is not JSON yields an empty method
 * list rather than an error: the transport reports the parse failure itself.
 */
export async function summarizeMcpRequest(request: Request): Promise<McpRequestSummary> {
  const summary: McpRequestSummary = {
    methods: [],
    tools: [],
    protocolVersion: str(request.headers.get('mcp-protocol-version')),
    mcpMethodHeader: str(request.headers.get('mcp-method')),
    userAgent: str(request.headers.get('user-agent')),
  }

  let body: unknown
  try {
    body = await request.clone().json()
  } catch {
    return summary
  }

  for (const call of Array.isArray(body) ? body : [body]) {
    if (!isRecord(call)) continue
    const method = str(call.method)
    if (method) summary.methods.push(method)
    const params = isRecord(call.params) ? call.params : undefined
    if (!params) continue

    if (method === 'tools/call' && str(params.name)) summary.tools.push(params.name as string)

    // 2025-era handshake: the client names itself and its revision in initialize.
    if (method === 'initialize') {
      summary.protocolVersion ??= str(params.protocolVersion)
      if (isRecord(params.clientInfo)) {
        summary.clientName ??= str(params.clientInfo.name)
        summary.clientVersion ??= str(params.clientInfo.version)
      }
    }

    // 2026-07-28: every request carries its revision and client in _meta.
    const meta = isRecord(params._meta) ? params._meta : undefined
    if (meta) {
      summary.protocolVersion ??= str(meta[META_PROTOCOL_VERSION])
      const clientInfo = meta[META_CLIENT_INFO]
      if (isRecord(clientInfo)) {
        summary.clientName ??= str(clientInfo.name)
        summary.clientVersion ??= str(clientInfo.version)
      }
    }
  }
  return summary
}

/** The JSON-RPC error message(s) in a failed response body, trimmed. */
function errorMessageOf(body: unknown): string | undefined {
  const messages = (Array.isArray(body) ? body : [body])
    .map((entry) =>
      isRecord(entry) && isRecord(entry.error) ? str(entry.error.message) : undefined
    )
    .filter((m): m is string => Boolean(m))
  if (messages.length === 0) return undefined
  const joined = messages.join(' | ')
  return joined.length > MAX_ERROR_LENGTH ? `${joined.slice(0, MAX_ERROR_LENGTH)}…` : joined
}

/** Tool count of a single `tools/list` result, when the body is one. */
function toolCountOf(body: unknown): number | undefined {
  if (!isRecord(body) || !isRecord(body.result)) return undefined
  return Array.isArray(body.result.tools) ? body.result.tools.length : undefined
}

/**
 * Emit the request's line once the response exists. Reads a clone of the
 * response only when it is worth it: a failure (to record why) or a
 * `tools/list` (to record how many tools the client was shown, and how big
 * the list was). Event streams are never read.
 */
export async function logMcpRequest(
  summary: McpRequestSummary,
  response: Response,
  startedAt: number
): Promise<void> {
  const status = response.status
  const fields: Record<string, unknown> = {
    mcp_methods: summary.methods,
    status,
    duration_ms: Date.now() - startedAt,
  }
  if (summary.tools.length > 0) fields.mcp_tools = summary.tools
  if (summary.protocolVersion) fields.mcp_protocol_version = summary.protocolVersion
  if (summary.mcpMethodHeader) fields.mcp_method_header = summary.mcpMethodHeader
  if (summary.clientName) fields.mcp_client = summary.clientName
  if (summary.clientVersion) fields.mcp_client_version = summary.clientVersion
  if (summary.userAgent) fields.user_agent = summary.userAgent
  if (summary.authMethod) fields.auth_method = summary.authMethod
  if (summary.credentialId) fields.credential_id = summary.credentialId

  const isJson = (response.headers.get('content-type') ?? '').includes('application/json')
  const wantsBody = status >= 400 || summary.methods.includes('tools/list')
  if (isJson && wantsBody) {
    try {
      const text = await response.clone().text()
      const body: unknown = JSON.parse(text)
      const error = errorMessageOf(body)
      if (error) fields.error = error
      const toolCount = toolCountOf(body)
      if (toolCount !== undefined) {
        fields.tool_count = toolCount
        fields.response_bytes = text.length
      }
    } catch {
      // A body that is not JSON is still logged by status alone.
    }
  }

  if (status >= 500) logger.error(fields, 'mcp request')
  else if (status >= 400) logger.warn(fields, 'mcp request')
  else logger.info(fields, 'mcp request')
}
