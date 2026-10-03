/**
 * First-party MCP tools as AssistantToolSpecs, in-process (no HTTP self-loop).
 *
 * Slack / workspace_assistant uses the same catalogue as POST /api/mcp instead
 * of a parallel built-in list/get/write set. Writes still go through the
 * assistant propose pipeline.
 */
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { modelInputSchema } from './model-input-schema'
import { db, principal, user, eq } from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
import { RETRIEVED_CONTENT_NOTE } from './injection-guard'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import { expandWriteGrants } from '@/lib/shared/api-key-scopes'
import { isTeamMember } from '@/lib/shared/roles'
import { orderScopes, scopeForPermission, type ApiKeyScope } from '@/lib/shared/api-key-scopes'
import { toolGroupFromAnnotations } from '@/lib/shared/assistant/connectors'
import type { McpAuthContext } from '@/lib/server/mcp/types'
import { workspaceNavigationInputSchema } from '@/lib/server/mcp/tools/navigation'
import {
  settingsAreaSchema,
  settingsProposalInputSchema,
} from '@/lib/shared/assistant/settings-proposals'
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
  const permissions = actor.permissions ?? resolveActorPermissions(actor.role)
  const scopes = [...permissions].map(scopeForPermission)
  if (permissions.has(PERMISSIONS.CHANGELOG_MANAGE)) scopes.push('write:settings')
  const navigationPermissions = [
    PERMISSIONS.AUTH_MANAGE,
    PERMISSIONS.BILLING_MANAGE,
    PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
    PERMISSIONS.MEMBER_MANAGE,
    PERMISSIONS.API_KEY_MANAGE,
    PERMISSIONS.INTEGRATION_MANAGE,
    PERMISSIONS.STATUS_PAGE_MANAGE,
  ]
  if (navigationPermissions.some((permission) => permissions.has(permission)))
    scopes.push('read:settings')
  return orderScopes(expandWriteGrants(scopes))
}

async function teammateProfile(principalId: Actor['principalId']) {
  if (!principalId) return undefined
  const [row] = await db
    .select({
      userId: principal.userId,
      displayName: principal.displayName,
      email: user.email,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(principal.id, principalId))
    .limit(1)
  return row
}

export type AskingTeammateIdentity = {
  principalId: NonNullable<Actor['principalId']>
  displayName: string | null
  email: string | null
  role: 'admin' | 'member'
}

/** Name/email/role for the teammate who asked this workspace turn. */
export async function loadAskingTeammateIdentity(
  actor: Actor
): Promise<AskingTeammateIdentity | null> {
  if (!actor.principalId || (actor.role !== 'admin' && actor.role !== 'member')) return null
  try {
    const row = await teammateProfile(actor.principalId)
    return {
      principalId: actor.principalId,
      displayName: row?.displayName ?? null,
      email: row?.email ?? null,
      role: actor.role,
    }
  } catch {
    return {
      principalId: actor.principalId,
      displayName: null,
      email: null,
      role: actor.role,
    }
  }
}

export async function mcpAuthFromActor(
  actor: Actor,
  displayName: string
): Promise<McpAuthContext | null> {
  if (!actor.principalId || !isTeamMember(actor.role) || !actor.role) return null
  const scopes = scopesFromActor(actor)
  if (scopes.length === 0) return null
  const row = await teammateProfile(actor.principalId)
  return {
    principalId: actor.principalId,
    userId: row?.userId ?? undefined,
    name: row?.displayName || displayName,
    email: row?.email ?? undefined,
    role: actor.role,
    authMethod: 'oauth',
    permissions: actor.permissions,
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
  const frame = (result: { ok: boolean; data: string; note?: string }) => {
    if (name === 'navigate_workspace' && result.ok) {
      try {
        const serialized = JSON.parse(result.data)
        const content =
          serialized.structured ??
          JSON.parse(
            serialized.content?.find((item: { type: string }) => item.type === 'text')?.text ?? '{}'
          )
        const card = content.navigation
        if (
          card &&
          typeof card.href === 'string' &&
          card.href.startsWith('/admin/') &&
          typeof card.label === 'string'
        ) {
          ctx.ledger.navigation ??= []
          if (!ctx.ledger.navigation.some((item) => item.href === card.href))
            ctx.ledger.navigation.push(card)
        }
      } catch {
        /* A malformed result remains data and never supplies a navigation target. */
      }
    }
    return { ...result, note: [result.note, RETRIEVED_CONTENT_NOTE].filter(Boolean).join(' ') }
  }
  if (ctx.mcpSession) return frame(await ctx.mcpSession.callTool(name, payload))
  const auth = await mcpAuthFromActor(ctx.actor, ctx.assistantName)
  if (!auth) return { ok: false, data: '', note: 'Not authorized for workspace tools.' }
  const opened = await openWorkspaceMcp(auth)
  try {
    return frame(await opened.session.callTool(name, payload))
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

function workspaceWriteGuidance(name: string, description: string): string {
  const asUser = `${description} Runs as the teammate who asked — they are the author/actor, not you. Do not claim a proposal is required.`
  if (name === 'triage_post') {
    return `${asUser} When they say assign to me, pass ownerPrincipalId "me" or their principal id from trusted runtime context.`
  }
  return asUser
}

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
      ? workspaceWriteGuidance(tool.name, description)
      : tool.name === 'search'
        ? `${description} When a row includes url, link it as [title](url) copied verbatim. Paginate with nextCursor from the previous result. Leave citations empty for these lists. For "my posts" or "created by me", pass authorPrincipalId "me" or authorEmail "me".`
        : `${description} When a row includes url, link it as [title](url) copied verbatim. Paginate with nextCursor from the previous result. Leave citations empty for these lists.`,
    risk: group === 'read' ? 'read' : 'write',
    permissions: [],
    parents: ['conversation', 'ticket'],
    approvalPolicy: group === 'read' || writeAsUser ? 'always' : 'approval',
    definition: toolDefinition({
      name: tool.name,
      description,
      inputSchema:
        tool.name === 'propose_settings_change'
          ? modelInputSchema(settingsProposalInputSchema)
          : tool.name === 'get_settings'
            ? z.object({ area: settingsAreaSchema }).strict()
            : tool.name === 'navigate_workspace'
              ? workspaceNavigationInputSchema
              : jsonSchemaToZod(tool.inputSchema),
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
