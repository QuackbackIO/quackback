/**
 * Quinn Connectors service — CRUD, sync, and per-tool permission rules for
 * outbound MCP server connections.
 */
import { z } from 'zod'
import { generateId, type AssistantConnectorId, type PrincipalId } from '@quackback/ids'
import {
  assistantConnectors,
  db as defaultDb,
  eq,
  type AssistantConnectorRow,
  type ConnectorToolRule,
  type StoredConnectorAssignments,
  type StoredConnectorTool,
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { encrypt, decrypt } from '@/lib/server/encryption'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { assistantToolRuleSchema } from '@/lib/shared/assistant/config'
import { callRemoteConnectorTool, listRemoteConnectorTools } from './connectors.mcp-client'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-connectors' })

const AUTH_PURPOSE = 'assistant-connector-auth'

export const connectorAssignmentsSchema = z.object({
  agent: z.boolean(),
  copilot: z.boolean(),
})

export const createConnectorSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url().max(2000),
  authToken: z.string().max(4000).optional().nullable(),
  assignments: connectorAssignmentsSchema.default({ agent: true, copilot: true }),
  enabled: z.boolean().default(true),
})

export const updateConnectorSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  url: z.string().url().max(2000).optional(),
  /** Pass null to clear; omit to leave unchanged; string to replace. */
  authToken: z.string().max(4000).nullable().optional(),
  assignments: connectorAssignmentsSchema.optional(),
  enabled: z.boolean().optional(),
})

export const connectorToolRuleUpdateSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1).max(200),
  rule: assistantToolRuleSchema,
})

function slugifyConnectorName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return slug.length > 0 ? slug : 'connector'
}

function sealAuthToken(token: string | null | undefined): string | null {
  if (!token) return null
  return encrypt(token, AUTH_PURPOSE)
}

function openAuthToken(ciphertext: string | null): string | null {
  if (!ciphertext) return null
  return decrypt(ciphertext, AUTH_PURPOSE)
}

export interface ConnectorPublicDTO {
  id: string
  name: string
  slug: string
  url: string
  hasAuthToken: boolean
  tools: StoredConnectorTool[]
  toolRules: Record<string, ConnectorToolRule>
  assignments: StoredConnectorAssignments
  enabled: boolean
  lastSyncedAt: string | null
  lastSyncError: string | null
  createdAt: string
  updatedAt: string
}

export function toConnectorPublicDTO(row: AssistantConnectorRow): ConnectorPublicDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    hasAuthToken: Boolean(row.authTokenCiphertext),
    tools: row.tools ?? [],
    toolRules: row.toolRules ?? {},
    assignments: row.assignments,
    enabled: row.enabled,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: row.lastSyncError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function assertSlugUnique(
  slug: string,
  excludeId: AssistantConnectorId | null,
  execDb: Executor
): Promise<void> {
  const rows = await execDb.select().from(assistantConnectors)
  const clash = rows.find(
    (row) => row.slug.toLowerCase() === slug.toLowerCase() && row.id !== excludeId
  )
  if (clash) {
    throw new ConflictError(
      'CONNECTOR_SLUG_CONFLICT',
      'A connector with this name already exists. Choose a different name.'
    )
  }
}

export async function listConnectors(execDb: Executor = defaultDb): Promise<ConnectorPublicDTO[]> {
  const rows = await execDb.select().from(assistantConnectors)
  return rows.sort((a, b) => a.name.localeCompare(b.name)).map(toConnectorPublicDTO)
}

export async function createConnector(
  input: z.infer<typeof createConnectorSchema>,
  createdById: PrincipalId | null,
  execDb: Executor = defaultDb
): Promise<ConnectorPublicDTO> {
  const parsed = createConnectorSchema.parse(input)
  const slug = slugifyConnectorName(parsed.name)
  await assertSlugUnique(slug, null, execDb)

  const id = generateId('assistant_connector') as AssistantConnectorId
  const [row] = await execDb
    .insert(assistantConnectors)
    .values({
      id,
      name: parsed.name,
      slug,
      url: parsed.url,
      authTokenCiphertext: sealAuthToken(parsed.authToken ?? null),
      assignments: parsed.assignments,
      enabled: parsed.enabled,
      tools: [],
      toolRules: {},
      createdById,
    })
    .returning()

  // Best-effort initial sync so the catalogue is ready for permissions UI.
  try {
    return await syncConnectorTools(row.id as AssistantConnectorId, execDb)
  } catch (error) {
    log.warn({ err: error, connector_id: row.id }, 'initial connector sync failed')
    return toConnectorPublicDTO(row)
  }
}

export async function updateConnector(
  input: z.infer<typeof updateConnectorSchema>,
  execDb: Executor = defaultDb
): Promise<ConnectorPublicDTO> {
  const parsed = updateConnectorSchema.parse(input)
  const id = parsed.id as AssistantConnectorId
  const [existing] = await execDb
    .select()
    .from(assistantConnectors)
    .where(eq(assistantConnectors.id, id))
    .limit(1)
  if (!existing) throw new NotFoundError('CONNECTOR_NOT_FOUND', 'Connector not found')

  let slug = existing.slug
  if (parsed.name && parsed.name !== existing.name) {
    slug = slugifyConnectorName(parsed.name)
    await assertSlugUnique(slug, id, execDb)
  }

  let authTokenCiphertext = existing.authTokenCiphertext
  if (parsed.authToken !== undefined) {
    authTokenCiphertext = sealAuthToken(parsed.authToken)
  }

  const [row] = await execDb
    .update(assistantConnectors)
    .set({
      name: parsed.name ?? existing.name,
      slug,
      url: parsed.url ?? existing.url,
      authTokenCiphertext,
      assignments: parsed.assignments ?? existing.assignments,
      enabled: parsed.enabled ?? existing.enabled,
      updatedAt: new Date(),
    })
    .where(eq(assistantConnectors.id, id))
    .returning()

  return toConnectorPublicDTO(row!)
}

export async function deleteConnector(
  id: AssistantConnectorId,
  execDb: Executor = defaultDb
): Promise<void> {
  await execDb.delete(assistantConnectors).where(eq(assistantConnectors.id, id))
}

export async function syncConnectorTools(
  id: AssistantConnectorId,
  execDb: Executor = defaultDb
): Promise<ConnectorPublicDTO> {
  const [existing] = await execDb
    .select()
    .from(assistantConnectors)
    .where(eq(assistantConnectors.id, id))
    .limit(1)
  if (!existing) throw new NotFoundError('CONNECTOR_NOT_FOUND', 'Connector not found')

  try {
    const tools = await listRemoteConnectorTools({
      url: existing.url,
      authToken: openAuthToken(existing.authTokenCiphertext),
    })
    // Preserve rules for tools that still exist; drop orphan rules.
    const nextRules: Record<string, ConnectorToolRule> = {}
    for (const tool of tools) {
      const prior = existing.toolRules?.[tool.name]
      if (prior) nextRules[tool.name] = prior
    }
    const [row] = await execDb
      .update(assistantConnectors)
      .set({
        tools,
        toolRules: nextRules,
        lastSyncedAt: new Date(),
        lastSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(assistantConnectors.id, id))
      .returning()
    return toConnectorPublicDTO(row!)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sync connector tools'
    log.warn({ err: error, connector_id: id }, 'connector sync failed')
    await execDb
      .update(assistantConnectors)
      .set({ lastSyncError: message, updatedAt: new Date() })
      .where(eq(assistantConnectors.id, id))
    throw new ValidationError('CONNECTOR_SYNC_FAILED', message, error)
  }
}

export async function updateConnectorToolRule(
  input: z.infer<typeof connectorToolRuleUpdateSchema>,
  execDb: Executor = defaultDb
): Promise<ConnectorPublicDTO> {
  const parsed = connectorToolRuleUpdateSchema.parse(input)
  const id = parsed.id as AssistantConnectorId
  const [existing] = await execDb
    .select()
    .from(assistantConnectors)
    .where(eq(assistantConnectors.id, id))
    .limit(1)
  if (!existing) throw new NotFoundError('CONNECTOR_NOT_FOUND', 'Connector not found')
  const known = (existing.tools ?? []).some((tool) => tool.name === parsed.toolName)
  if (!known) {
    throw new ValidationError(
      'CONNECTOR_TOOL_UNKNOWN',
      'That tool is not in this connector catalogue'
    )
  }
  const nextRules = { ...(existing.toolRules ?? {}), [parsed.toolName]: parsed.rule }
  const [row] = await execDb
    .update(assistantConnectors)
    .set({ toolRules: nextRules, updatedAt: new Date() })
    .where(eq(assistantConnectors.id, id))
    .returning()
  return toConnectorPublicDTO(row!)
}

/** Endpoint + auth for a stored connector row (decrypts token). */
export function connectorEndpoint(row: AssistantConnectorRow) {
  return {
    url: row.url,
    authToken: openAuthToken(row.authTokenCiphertext),
  }
}

export async function invokeConnectorTool(
  row: AssistantConnectorRow,
  remoteToolName: string,
  args: Record<string, unknown>
) {
  return callRemoteConnectorTool(connectorEndpoint(row), remoteToolName, args)
}
