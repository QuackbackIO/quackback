/**
 * The MCP boundary audit: one `mcp.tool_call` row for every tool call that is
 * not read-only, whether it came over HTTP or from the assistant driving the
 * same catalogue in-process. The row is attributed to whatever boundary the
 * call runs under (the OAuth client or API key, or the assistant) and names
 * the tool, the resource it acted on and the outcome. It never holds the
 * arguments or the result. It costs one insert and no read.
 */
import type { CallToolResult } from '@modelcontextprotocol/server'
import { logger } from '@/lib/server/logger'
import { recordAuditEvent, type AuditTarget } from '@/lib/server/audit/log'
import { typeIdTarget } from '@/lib/server/audit/targets'
import type { McpAuthContext } from './types'

const log = logger.child({ component: 'audit' })

/** A created resource is read back from results up to this size; larger ones are lists. */
const RESULT_SCAN_MAX_LEN = 64 * 1024

/** What a call's outcome is called when it fails. */
export type McpToolErrorCode =
  | 'FEATURE_DISABLED'
  | 'INSUFFICIENT_SCOPE'
  | 'FORBIDDEN'
  | 'MISSING_PERMISSION'
  | 'TOOL_ERROR'
  | 'INTERNAL_ERROR'
  | (string & {})

/**
 * The resource a call points at: its `id` argument, else the first `…Id`
 * argument holding a TypeID, else the id of what it created.
 */
export function mcpToolTarget(args: unknown, result: CallToolResult): AuditTarget | null {
  if (args && typeof args === 'object') {
    const entries = Object.entries(args as Record<string, unknown>)
    const byId = typeIdTarget((args as Record<string, unknown>).id)
    if (byId) return byId
    for (const [key, value] of entries) {
      if (!key.endsWith('Id')) continue
      const target = typeIdTarget(value)
      if (target) return target
    }
  }
  if (result.isError) return null
  const first = result.content?.[0]
  if (first?.type !== 'text' || first.text.length > RESULT_SCAN_MAX_LEN) return null
  try {
    const parsed: unknown = JSON.parse(first.text)
    return parsed && typeof parsed === 'object'
      ? typeIdTarget((parsed as Record<string, unknown>).id)
      : null
  } catch {
    return null
  }
}

/**
 * The caller's HTTP headers, when the call came over HTTP: the request on the
 * handler context (`ctx.http.req`), or a plain header record under
 * `requestInfo` (the older SDK context shape, still used by in-process tests).
 */
function headersFrom(extra: unknown): Headers | undefined {
  const ctx = extra as
    | {
        http?: { req?: { headers?: unknown } }
        requestInfo?: { headers?: Record<string, unknown> }
      }
    | undefined
  const reqHeaders = ctx?.http?.req?.headers
  if (reqHeaders instanceof Headers) return reqHeaders
  const raw = ctx?.requestInfo?.headers
  if (!raw) return undefined
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string') headers.set(name, value)
    else if (Array.isArray(value)) headers.set(name, value.join(', '))
  }
  return headers
}

/** Record one tool call. Never throws: a failure is logged and the result goes out. */
export async function recordMcpToolCall(input: {
  auth: McpAuthContext
  tool: string
  args: unknown
  result: CallToolResult
  errorCode: McpToolErrorCode | null
  extra?: unknown
}): Promise<void> {
  try {
    const { auth } = input
    const target = mcpToolTarget(input.args, input.result)
    await recordAuditEvent({
      event: 'mcp.tool_call',
      outcome: input.errorCode ? 'failure' : 'success',
      actor: {
        userId: auth.userId ?? null,
        email: auth.email ?? null,
        role: auth.role,
        type: auth.userId ? 'user' : 'service',
        authMethod: auth.authMethod === 'oauth' ? 'oauth' : 'api_key',
      },
      headers: headersFrom(input.extra),
      target: target ?? undefined,
      metadata: {
        tool: input.tool,
        ...(input.errorCode ? { errorCode: input.errorCode.slice(0, 100) } : {}),
      },
    })
  } catch (error) {
    log.error({ err: error, tool: input.tool }, 'mcp tool call audit failed')
  }
}
