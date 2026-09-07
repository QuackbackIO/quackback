/**
 * First-party MCP tools as AssistantToolSpecs, in-process (no HTTP self-loop).
 *
 * Slack / workspace_assistant uses the same catalogue as POST /api/mcp instead
 * of a parallel built-in list/get/write set. Writes still go through the
 * assistant propose pipeline.
 */
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { toolDefinition } from '@tanstack/ai'
import { db, principal, user, eq } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { isTeamMember } from '@/lib/shared/roles'
import {
  API_KEY_SCOPES,
  orderScopes,
  scopeForPermission,
  type ApiKeyScope,
} from '@/lib/shared/api-key-scopes'
import { toolGroupFromAnnotations } from '@/lib/shared/assistant/connectors'
import type { McpAuthContext } from '@/lib/server/mcp/types'
import {
  withGateEnvelope,
  type AssistantToolContext,
  type AssistantToolSpec,
} from './assistant.toolspec'
import { jsonSchemaToZod, connectorToolOutputSchema } from './connectors/connector-tools'
import {
  openConnectorSession,
  type ConnectorMcpSession,
  type DiscoveredMcpTool,
} from './connectors/mcp-client'

function scopesFromActor(actor: Actor): ApiKeyScope[] {
  if (!actor.permissions || actor.permissions.size === 0) {
    return isTeamMember(actor.role) ? [...API_KEY_SCOPES] : []
  }
  return orderScopes([...actor.permissions].map(scopeForPermission))
}

export async function mcpAuthFromActor(
  actor: Actor,
  displayName: string
): Promise<McpAuthContext | null> {
  if (!actor.principalId || !isTeamMember(actor.role) || !actor.role) return null
  const scopes = scopesFromActor(actor)
  if (scopes.length === 0) return null
  const [row] = await db
    .select({
      userId: principal.userId,
      displayName: principal.displayName,
      email: user.email,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(principal.id, actor.principalId))
    .limit(1)
  return {
    principalId: actor.principalId,
    userId: row?.userId ?? undefined,
    name: row?.displayName || displayName,
    email: row?.email ?? undefined,
    role: actor.role,
    authMethod: 'oauth',
    scopes,
  }
}

function keyArgsPreview(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const entries = Object.entries(args as Record<string, unknown>).slice(0, 4)
  if (entries.length === 0) return ''
  return entries
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ')
}

async function callWorkspaceMcpTool(
  name: string,
  args: unknown,
  ctx: AssistantToolContext
): Promise<{ ok: boolean; data: string; note?: string }> {
  const payload = (args ?? {}) as Record<string, unknown>
  if (ctx.mcpSession) return ctx.mcpSession.callTool(name, payload)
  const auth = await mcpAuthFromActor(ctx.actor, ctx.assistantName)
  if (!auth) return { ok: false, data: '', note: 'Not authorized for workspace tools.' }
  const opened = await openWorkspaceMcp(auth)
  try {
    return await opened.session.callTool(name, payload)
  } finally {
    await opened.close()
  }
}

/** Feedback the asking teammate can already do in the app — run as them, no extra approve. */
const WORKSPACE_USER_WRITES = new Set([
  'create_post',
  'triage_post',
  'vote_post',
  'add_comment',
  'update_comment',
  'react_to_comment',
])

function buildWorkspaceMcpSpec(tool: DiscoveredMcpTool): AssistantToolSpec {
  const group = toolGroupFromAnnotations(tool.annotations)
  const title = tool.title || tool.name
  const description = tool.description || title
  const writeAsUser = group === 'write' && WORKSPACE_USER_WRITES.has(tool.name)
  return {
    name: tool.name,
    label: title,
    description,
    promptGuidance: writeAsUser
      ? `${description} Runs as the teammate who asked — they are the author/actor, not you. Do not claim a proposal is required.`
      : `${description} When a row includes url, link it as [title](url) copied verbatim. Paginate with nextCursor from the previous result. Leave citations empty for these lists.`,
    risk: group === 'read' ? 'read' : 'write',
    permissions: [],
    parents: ['conversation', 'ticket'],
    approvalPolicy: group === 'read' || writeAsUser ? 'always' : 'approval',
    definition: toolDefinition({
      name: tool.name,
      description,
      inputSchema: jsonSchemaToZod(tool.inputSchema),
      outputSchema: withGateEnvelope(connectorToolOutputSchema),
    }),
    execute: (args, ctx) => callWorkspaceMcpTool(tool.name, args, ctx),
    summarize: (args) => {
      const preview = keyArgsPreview(args)
      return preview ? `${title} (${preview})` : title
    },
  }
}

export async function openWorkspaceMcp(auth: McpAuthContext): Promise<{
  session: ConnectorMcpSession
  specs: AssistantToolSpec[]
  close: () => Promise<void>
}> {
  const { createMcpServer } = await import('@/lib/server/mcp/server')
  const server = createMcpServer(auth)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const session = await openConnectorSession({
    url: 'https://quackback.invalid/mcp',
    auth: { mode: 'none' },
    transport: clientTransport,
  })
  const discovered = await session.listTools()
  return {
    session,
    specs: discovered.map(buildWorkspaceMcpSpec),
    close: async () => {
      await session.close()
      await server.close()
    },
  }
}

export async function getWorkspaceMcpSpecByName(
  toolName: string,
  actor: Actor,
  displayName: string
): Promise<AssistantToolSpec | null> {
  const auth = await mcpAuthFromActor(actor, displayName)
  if (!auth) return null
  const opened = await openWorkspaceMcp(auth)
  try {
    return opened.specs.find((spec) => spec.name === toolName) ?? null
  } finally {
    await opened.close()
  }
}
