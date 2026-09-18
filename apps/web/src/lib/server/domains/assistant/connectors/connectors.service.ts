/** Agent Connectors CRUD. Secrets never leave this module. */
import { and, eq, ne, sql } from 'drizzle-orm'
import {
  db as defaultDb,
  connectors,
  type CachedConnectorTool,
  type ConnectorProfilePolicies,
  type ConnectorToolPolicies,
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { ConnectorId, PrincipalId } from '@quackback/ids'
import { encrypt, decrypt } from '@/lib/server/encryption'
import { ConflictError, ValidationError } from '@/lib/shared/errors'
import { validationError } from '@/lib/server/domains/assistant/validation-error'
import { checkUrlSafety } from '@/lib/server/content/ssrf-guard'
import { logger } from '@/lib/server/logger'
import {
  connectorCreateInputSchema,
  connectorUpdateInputSchema,
  slugifyConnectorName,
  CONNECTOR_POLICY_PROFILES,
  DEFAULT_CONNECTOR_PROFILE_POLICY,
  DEFAULT_CONNECTOR_TOOL_POLICIES,
  type ConnectorCreateInput,
  type ConnectorProfilePolicy,
  type ConnectorUpdateInput,
} from '@/lib/shared/assistant/connectors'
// Re-exported so every existing caller keeps one import for "read a connector
// and shape it for the client".
export { toConnectorDTO } from './connector-dto'
import {
  effectiveConnectorPolicyState,
  ensureConnectorPolicyState,
  seedProfilePolicies,
} from './connector-policy-state'
import { applyConnectorCatalogDiff } from './discovery'
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

export async function listConnectors(execDb: Executor = defaultDb): Promise<ConnectorRow[]> {
  const rows = await execDb.select().from(connectors).orderBy(connectors.createdAt)
  const migrated: ConnectorRow[] = []
  for (const row of rows) migrated.push(await ensureConnectorPolicyState(row, execDb))
  return migrated
}

export async function getConnector(
  id: ConnectorId,
  execDb: Executor = defaultDb
): Promise<ConnectorRow | null> {
  const [row] = await execDb.select().from(connectors).where(eq(connectors.id, id)).limit(1)
  return row ? ensureConnectorPolicyState(row, execDb) : null
}

export type DiscoverIntoRow = Pick<
  ConnectorRow,
  | 'id'
  | 'url'
  | 'authMode'
  | 'secrets'
  | 'tools'
  | 'toolPolicies'
  | 'profilePolicies'
  | 'toolReviews'
  | 'catalogRevision'
  | 'assignments'
>

export async function discoverInto(row: DiscoverIntoRow, execDb: Executor) {
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
    return applyConnectorCatalogDiff(
      {
        tools: row.tools,
        toolPolicies: row.toolPolicies,
        profilePolicies: row.profilePolicies,
        toolReviews: row.toolReviews,
        catalogRevision: row.catalogRevision,
        assignments: row.assignments,
      },
      discovered
    )
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
      profilePolicies: seedProfilePolicies(input.assignments),
      toolReviews: {},
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
        // A brand-new connector has no reviewed contracts, so everything it
        // publishes starts unavailable until somebody reviews it: the
        // specification's connect, discover, review, enable order.
        profilePolicies: seedProfilePolicies(parsed.data.assignments),
        toolReviews: {},
        catalogRevision: 1,
        assignments: parsed.data.assignments,
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
      profilePolicies: seedProfilePolicies(parsed.data.assignments),
      toolReviews: {},
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

  const nextAssignments = parsed.data.assignments ?? existing.assignments
  const state = effectiveConnectorPolicyState(existing)
  const liveTools = new Set(existing.tools.map((tool) => tool.name))
  let policyEdited = false
  const nextPolicies: ConnectorProfilePolicies = { ...state.profilePolicies }
  if (parsed.data.profilePolicies) {
    if (parsed.data.expectedPolicyVersion === undefined) {
      throw new ValidationError(
        'CONNECTOR_POLICY_VERSION_REQUIRED',
        'Reload the connection before changing its permissions.'
      )
    }
    policyEdited = true
    // A patch, not a replacement: a client that sends one use's column must
    // not reset the other use's policy to defaults by omission. Removing a
    // use's access is what the assignment switch is for.
    for (const profile of CONNECTOR_POLICY_PROFILES) {
      const submitted = parsed.data.profilePolicies[profile]
      if (!submitted) continue
      // An override for a tool this catalog does not publish is dropped
      // rather than stored: it could only re-apply to some future tool that
      // happened to reuse the name.
      const tools: ConnectorProfilePolicy['tools'] = {}
      for (const [name, policy] of Object.entries(submitted.tools)) {
        if (liveTools.has(name)) tools[name] = policy
      }
      nextPolicies[profile] = { groupDefaults: submitted.groupDefaults, tools, origin: 'explicit' }
    }
  }
  // Assigning a use is an explicit act, so it writes that use's policy record
  // at the recommended defaults. Un-assigning leaves the record alone: the
  // assignment gate already denies, and keeping it means re-assigning restores
  // the decisions somebody made rather than silently reopening everything.
  for (const profile of CONNECTOR_POLICY_PROFILES) {
    if (nextAssignments[profile] === true && !nextPolicies[profile]) {
      nextPolicies[profile] = { ...DEFAULT_CONNECTOR_PROFILE_POLICY, tools: {}, origin: 'explicit' }
      policyEdited = true
    }
  }

  const [row] = await execDb
    .update(connectors)
    .set({
      name: nextName,
      slug: nextSlug,
      url: nextUrl,
      authMode: parsed.data.authMode ?? existing.authMode,
      secrets: nextSecrets,
      assignments: nextAssignments,
      profilePolicies: nextPolicies,
      toolReviews: state.toolReviews,
      policyVersion: policyEdited ? existing.policyVersion + 1 : existing.policyVersion,
      enabled: parsed.data.enabled ?? existing.enabled,
      updatedAt: new Date(),
    })
    .where(
      parsed.data.expectedPolicyVersion === undefined
        ? eq(connectors.id, id)
        : and(
            eq(connectors.id, id),
            eq(connectors.policyVersion, parsed.data.expectedPolicyVersion)
          )
    )
    .returning()

  if (!row && parsed.data.expectedPolicyVersion !== undefined) {
    throw new ConflictError(
      'CONNECTOR_POLICY_CONFLICT',
      'These permissions changed while you were editing them. Reload to see the current settings.'
    )
  }

  return row ?? null
}
