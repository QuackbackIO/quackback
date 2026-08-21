/** Agent Connectors CRUD. Secrets never leave this module. */
import { and, eq, ne, sql } from 'drizzle-orm'
import {
  db as defaultDb,
  connectors,
  type CachedConnectorTool,
  type ConnectorToolPolicies,
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { ConnectorId, PrincipalId } from '@quackback/ids'
import { encrypt, decrypt } from '@/lib/server/encryption'
import { ValidationError } from '@/lib/shared/errors'
import { validationError } from '@/lib/server/domains/assistant/validation-error'
import { checkUrlSafety } from '@/lib/server/content/ssrf-guard'
import { logger } from '@/lib/server/logger'
import {
  connectorCreateInputSchema,
  connectorUpdateInputSchema,
  resolveToolPolicy,
  slugifyConnectorName,
  DEFAULT_CONNECTOR_TOOL_POLICIES,
  type ConnectorCreateInput,
  type ConnectorDTO,
  type ConnectorToolDTO,
  type ConnectorUpdateInput,
} from '@/lib/shared/assistant/connectors'
import { applyCatalogDiff, groupForCachedTool, isNewTool } from './discovery'
import { openConnectorSession } from './mcp-client'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'

const log = logger.child({ component: 'assistant-connectors' })

export const CONNECTOR_SECRETS_PURPOSE = 'connector-secrets'

export class ConnectorOAuthRequiredError extends Error {
  constructor(public readonly row: ConnectorRow) {
    super('connector_oauth_required')
    this.name = 'ConnectorOAuthRequiredError'
  }
}

function isUnauthorized(err: unknown): boolean {
  if (err instanceof UnauthorizedError) return true
  return err instanceof Error && /\b401\b|unauthorized/i.test(err.message)
}

export type ConnectorRow = typeof connectors.$inferSelect

interface ConnectorSecrets {
  bearerToken?: string
  oauth?: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: string
    clientId?: string
    clientSecret?: string
    tokenEndpoint?: string
  }
}

function invalidConnector(error: unknown): never {
  return validationError('connector', error)
}

function encryptSecrets(secrets: ConnectorSecrets): string {
  return encrypt(JSON.stringify(secrets), CONNECTOR_SECRETS_PURPOSE)
}

function decryptSecrets(ciphertext: string | null): ConnectorSecrets {
  if (!ciphertext) return {}
  try {
    return JSON.parse(decrypt(ciphertext, CONNECTOR_SECRETS_PURPOSE)) as ConnectorSecrets
  } catch (err) {
    log.error({ err }, 'connector secrets decryption failed')
    return {}
  }
}

async function assertHttpsPublicUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ValidationError('CONNECTOR_URL_INVALID', 'Enter an HTTPS MCP server URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError('CONNECTOR_URL_INVALID', 'Enter an HTTPS MCP server URL')
  }
  const safety = await checkUrlSafety(url)
  if (!safety.safe) {
    throw new ValidationError(
      'CONNECTOR_URL_REJECTED',
      safety.reason === 'ssrf-rejected'
        ? 'That address cannot be reached from this workspace.'
        : 'The MCP server URL could not be resolved.'
    )
  }
}

async function assertSlugUnique(
  slug: string,
  excludeId: ConnectorId | null,
  execDb: Executor
): Promise<void> {
  const [row] = await execDb
    .select({ id: connectors.id })
    .from(connectors)
    .where(
      excludeId
        ? and(sql`lower(${connectors.slug}) = ${slug}`, ne(connectors.id, excludeId))
        : sql`lower(${connectors.slug}) = ${slug}`
    )
    .limit(1)
  if (row) {
    throw new ValidationError(
      'CONNECTOR_DUPLICATE_SLUG',
      'Another connector already uses a similar name. Choose a distinct name.'
    )
  }
}

function toToolDTO(
  tool: CachedConnectorTool,
  policies: ConnectorToolPolicies,
  lastSyncedAt: Date | null
): ConnectorToolDTO {
  const group = groupForCachedTool(tool)
  const policy = resolveToolPolicy(policies, tool.name, group)
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    group,
    destructive: tool.annotations.destructiveHint === true,
    policy,
    isOverride: policies.tools[tool.name] !== undefined,
    isNew: isNewTool(tool, lastSyncedAt),
  }
}

export function toConnectorDTO(row: ConnectorRow): ConnectorDTO {
  const policies = row.toolPolicies ?? DEFAULT_CONNECTOR_TOOL_POLICIES
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    authMode: row.authMode,
    hasSecret: Boolean(row.secrets),
    status: row.status,
    enabled: row.enabled,
    assignments: row.assignments,
    toolPolicies: policies,
    tools: row.tools.map((tool) => toToolDTO(tool, policies, row.lastSyncedAt)),
    toolCount: row.tools.length,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastCallAt: row.lastCallAt?.toISOString() ?? null,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listConnectors(execDb: Executor = defaultDb): Promise<ConnectorRow[]> {
  return execDb.select().from(connectors).orderBy(connectors.createdAt)
}

export async function getConnector(
  id: ConnectorId,
  execDb: Executor = defaultDb
): Promise<ConnectorRow | null> {
  const [row] = await execDb.select().from(connectors).where(eq(connectors.id, id)).limit(1)
  return row ?? null
}

export async function discoverInto(
  row: Pick<ConnectorRow, 'id' | 'url' | 'authMode' | 'secrets' | 'tools' | 'toolPolicies'>,
  execDb: Executor
) {
  const { getValidConnectorAccessToken, createConnectorOAuthProvider } =
    await import('./oauth-provider')
  const token = await getValidConnectorAccessToken(row as ConnectorRow, execDb)
  const authProvider =
    row.authMode === 'oauth' ? createConnectorOAuthProvider(row as ConnectorRow) : undefined
  const session = await openConnectorSession({
    url: row.url,
    auth: {
      mode: row.authMode,
      bearerToken: row.authMode === 'bearer' ? (token ?? undefined) : undefined,
      accessToken: row.authMode === 'oauth' ? (token ?? undefined) : undefined,
    },
    authProvider,
  })
  try {
    const discovered = await session.listTools()
    return applyCatalogDiff(row.tools, discovered, row.toolPolicies)
  } finally {
    await session.close()
  }
}

async function insertPendingOAuthRow(
  input: {
    name: string
    slug: string
    url: string
    assignments: ConnectorCreateInput['assignments']
    createdByPrincipalId?: PrincipalId | null
  },
  execDb: Executor
): Promise<ConnectorRow> {
  const [row] = await execDb
    .insert(connectors)
    .values({
      name: input.name,
      slug: input.slug,
      url: input.url,
      authMode: 'oauth',
      status: 'error',
      tools: [],
      toolPolicies: { ...DEFAULT_CONNECTOR_TOOL_POLICIES },
      assignments: input.assignments,
      lastError: 'Authorization required',
      lastErrorAt: new Date(),
      createdByPrincipalId: input.createdByPrincipalId ?? null,
    })
    .returning()

  return row
}

export async function createConnector(
  input: ConnectorCreateInput & { createdByPrincipalId?: PrincipalId | null },
  execDb: Executor = defaultDb
): Promise<ConnectorRow> {
  const parsed = connectorCreateInputSchema.safeParse(input)
  if (!parsed.success) invalidConnector(parsed.error)
  await assertHttpsPublicUrl(parsed.data.url)
  const slug = slugifyConnectorName(parsed.data.name)
  await assertSlugUnique(slug, null, execDb)
  if (parsed.data.authMode === 'bearer' && !parsed.data.bearerToken) {
    throw new ValidationError('CONNECTOR_BEARER_REQUIRED', 'Enter a bearer token for this server.')
  }

  const secrets = parsed.data.bearerToken
    ? encryptSecrets({ bearerToken: parsed.data.bearerToken })
    : null

  if (parsed.data.authMode === 'oauth') {
    const pending = await insertPendingOAuthRow(
      {
        name: parsed.data.name,
        slug,
        url: parsed.data.url,
        assignments: parsed.data.assignments,
        createdByPrincipalId: input.createdByPrincipalId,
      },
      execDb
    )
    throw new ConnectorOAuthRequiredError(pending)
  }

  let tools: CachedConnectorTool[]
  let toolPolicies: ConnectorToolPolicies = { ...DEFAULT_CONNECTOR_TOOL_POLICIES }
  const status: ConnectorRow['status'] = 'connected'
  const lastError: string | null = null
  try {
    const diff = await discoverInto(
      {
        id: 'connector_pending' as ConnectorId,
        url: parsed.data.url,
        authMode: parsed.data.authMode,
        secrets,
        tools: [],
        toolPolicies,
      },
      execDb
    )
    tools = diff.tools
    toolPolicies = diff.toolPolicies
  } catch (err) {
    log.warn({ err }, 'connector discover on create failed')
    if (isUnauthorized(err) && parsed.data.authMode !== 'bearer') {
      const pending = await insertPendingOAuthRow(
        {
          name: parsed.data.name,
          slug,
          url: parsed.data.url,
          assignments: parsed.data.assignments,
          createdByPrincipalId: input.createdByPrincipalId,
        },
        execDb
      )
      throw new ConnectorOAuthRequiredError(pending)
    }
    throw new ValidationError(
      'CONNECTOR_DISCOVER_FAILED',
      err instanceof Error ? err.message : 'Could not connect to that MCP server.'
    )
  }

  const [row] = await execDb
    .insert(connectors)
    .values({
      name: parsed.data.name,
      slug,
      url: parsed.data.url,
      authMode: parsed.data.authMode,
      secrets,
      status,
      tools,
      toolPolicies,
      assignments: parsed.data.assignments,
      lastSyncedAt: new Date(),
      lastError,
      createdByPrincipalId: input.createdByPrincipalId ?? null,
    })
    .returning()

  return row
}

export async function updateConnector(
  id: ConnectorId,
  input: Omit<ConnectorUpdateInput, 'id'>,
  execDb: Executor = defaultDb
): Promise<ConnectorRow | null> {
  const parsed = connectorUpdateInputSchema.safeParse({ ...input, id })
  if (!parsed.success) invalidConnector(parsed.error)
  const existing = await getConnector(id, execDb)
  if (!existing) return null

  const nextName = parsed.data.name ?? existing.name
  const nextSlug = parsed.data.name ? slugifyConnectorName(parsed.data.name) : existing.slug
  if (nextSlug !== existing.slug) await assertSlugUnique(nextSlug, id, execDb)
  const nextUrl = parsed.data.url ?? existing.url
  if (nextUrl !== existing.url) await assertHttpsPublicUrl(nextUrl)

  const currentSecrets = decryptSecrets(existing.secrets)
  if (parsed.data.clearBearerToken) delete currentSecrets.bearerToken
  if (parsed.data.bearerToken) currentSecrets.bearerToken = parsed.data.bearerToken
  const nextSecrets = Object.keys(currentSecrets).length > 0 ? encryptSecrets(currentSecrets) : null

  const [row] = await execDb
    .update(connectors)
    .set({
      name: nextName,
      slug: nextSlug,
      url: nextUrl,
      authMode: parsed.data.authMode ?? existing.authMode,
      secrets: nextSecrets,
      assignments: parsed.data.assignments ?? existing.assignments,
      toolPolicies: parsed.data.toolPolicies ?? existing.toolPolicies,
      enabled: parsed.data.enabled ?? existing.enabled,
      updatedAt: new Date(),
    })
    .where(eq(connectors.id, id))
    .returning()

  return row ?? null
}
