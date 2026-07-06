/**
 * Data Connector v0 service: CRUD and the validation invariants (HTTPS-only,
 * unique name/slug, no static-tool collision, auth/timeout/input shape). The
 * call executor (executeConnector/testConnector) lives in connector.execute.ts.
 *
 * The secret is write-only: create/update accept a plaintext secret and
 * encrypt it (connector.encryption.ts); every read DTO reports only
 * `hasSecret`, never the ciphertext or plaintext. Execution decrypts
 * just-in-time, in connector.execute.ts, and never persists the plaintext.
 */
import { db, eq, sql, dataConnectors } from '@/lib/server/db'
import { createId, type DataConnectorId, type PrincipalId } from '@quackback/ids'
import { slugify } from '@/lib/shared/utils'
import { ValidationError, NotFoundError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { encryptConnectorSecret } from './connector.encryption'
import type { JsonValue } from '@/lib/shared/json'
import type {
  DataConnector,
  CreateConnectorInput,
  UpdateConnectorInput,
  ConnectorAuthConfig,
  ConnectorInputField,
  ConnectorHeader,
} from './connector.types'

const log = logger.child({ component: 'connectors' })

/** Hard cap mirroring the `timeout_ms` column CHECK. */
const MAX_TIMEOUT_MS = 30000
const DEFAULT_TIMEOUT_MS = 10000

export type ConnectorRow = typeof dataConnectors.$inferSelect

/** name -> slug: hyphenated slugify output feeds a snake_case tool id
 *  (`connector_{slug}`), so hyphens are folded to underscores. */
function toConnectorSlug(name: string): string {
  return slugify(name).replace(/-/g, '_')
}

function mapConnector(row: ConnectorRow): DataConnector {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    method: row.method,
    urlTemplate: row.urlTemplate,
    headers: row.headers,
    auth: row.auth,
    hasSecret: row.secretCiphertext !== null,
    inputs: row.inputs,
    bodyTemplate: row.bodyTemplate,
    exampleResponse: (row.exampleResponse as JsonValue | null) ?? null,
    responsePaths: row.responsePaths,
    timeoutMs: row.timeoutMs,
    enabled: row.enabled,
    status: row.status,
    failureCount: row.failureCount,
    lastError: row.lastError,
    lastTestedAt: row.lastTestedAt,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Audit-safe projection of a connector: name, method, and enabled only.
 * `headers` and `auth` can carry a live secret value (e.g. a custom auth
 * header or bearer token), so they — and everything else on the row — are
 * deliberately excluded. The one place this exclusion is decided; every
 * audit-log call site for connector CRUD should go through this rather than
 * hand-picking fields.
 */
export function toAuditSafeConnector(
  connector: DataConnector
): Pick<DataConnector, 'name' | 'method' | 'enabled'> {
  return { name: connector.name, method: connector.method, enabled: connector.enabled }
}

function validateUrlTemplate(template: string): void {
  if (!/^https:\/\//i.test(template)) {
    throw new ValidationError('VALIDATION_ERROR', 'Connector URL must use HTTPS')
  }
  try {
    // Placeholders aren't a valid URL component on their own; substitute a
    // dummy so the surrounding URL shape (host, path) still validates.
    new URL(template.replace(/\{[\w.]+\}/g, 'x'))
  } catch {
    throw new ValidationError('VALIDATION_ERROR', 'Invalid connector URL')
  }
}

const INPUT_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function validateInputs(inputs: ConnectorInputField[]): void {
  const seen = new Set<string>()
  for (const input of inputs) {
    if (!INPUT_NAME_PATTERN.test(input.name)) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        `Invalid input name "${input.name}": use letters, numbers, and underscores, not starting with a digit`
      )
    }
    if (seen.has(input.name)) {
      throw new ValidationError('VALIDATION_ERROR', `Duplicate input name "${input.name}"`)
    }
    seen.add(input.name)
  }
}

function validateHeaders(headers: ConnectorHeader[]): void {
  for (const header of headers) {
    if (!header.name.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Header name cannot be empty')
    }
  }
}

/** `auth.type !== 'none'` needs a secret to actually authenticate with — either
 *  a new one in this request or one already on the row. `header` also needs
 *  a header name to send it under. */
function validateAuthConfig(auth: ConnectorAuthConfig, secretAvailable: boolean): void {
  if (auth.type === 'header' && !auth.headerName?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'A header auth type requires headerName')
  }
  if (auth.type !== 'none' && !secretAvailable) {
    throw new ValidationError('VALIDATION_ERROR', `A ${auth.type} auth type requires a secret`)
  }
}

function validateTimeout(timeoutMs: number): void {
  if (timeoutMs > MAX_TIMEOUT_MS || timeoutMs <= 0) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`
    )
  }
}

/** The tool id a connector would occupy (`connector_{slug}`) must not shadow
 *  one of the assistant's built-in static tools. Connector tool ids are
 *  always prefixed, so this only ever fires if a future static tool is named
 *  with the same prefix — defensive, but cheap and explicitly requested. */
async function assertNoStaticToolCollision(slug: string): Promise<void> {
  const { ASSISTANT_TOOL_SPECS } = await import('@/lib/server/domains/assistant/assistant.toolspec')
  const toolId = `connector_${slug}`
  if (toolId in ASSISTANT_TOOL_SPECS) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `"${slug}" collides with a built-in assistant tool`
    )
  }
}

async function assertNameAndSlugAvailable(
  name: string,
  slug: string,
  excludeId?: DataConnectorId
): Promise<void> {
  const existing = await db
    .select({ id: dataConnectors.id, name: dataConnectors.name, slug: dataConnectors.slug })
    .from(dataConnectors)
    .where(sql`${dataConnectors.name} = ${name} OR ${dataConnectors.slug} = ${slug}`)
  const collision = existing.find((row) => row.id !== excludeId)
  if (collision) {
    throw new ValidationError('VALIDATION_ERROR', `A connector named "${name}" already exists`)
  }
}

export async function createConnector(
  input: CreateConnectorInput,
  createdById: PrincipalId | null
): Promise<DataConnector> {
  const name = input.name.trim()
  if (!name) throw new ValidationError('VALIDATION_ERROR', 'Connector name is required')
  const slug = toConnectorSlug(name)
  if (!slug) throw new ValidationError('VALIDATION_ERROR', 'Could not derive a slug from the name')

  validateUrlTemplate(input.urlTemplate)
  const inputs = input.inputs ?? []
  validateInputs(inputs)
  const headers = input.headers ?? []
  validateHeaders(headers)
  const auth = input.auth ?? { type: 'none' as const }
  validateAuthConfig(auth, Boolean(input.secret))
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  validateTimeout(timeoutMs)

  await assertNameAndSlugAvailable(name, slug)
  await assertNoStaticToolCollision(slug)

  const id = createId('data_connector')
  const [row] = await db
    .insert(dataConnectors)
    .values({
      id,
      name,
      slug,
      description: input.description,
      method: input.method,
      urlTemplate: input.urlTemplate,
      headers,
      auth,
      secretCiphertext: input.secret ? encryptConnectorSecret(input.secret) : null,
      inputs,
      bodyTemplate: input.bodyTemplate ?? null,
      timeoutMs,
      enabled: input.enabled ?? false,
      createdById,
    })
    .returning()

  log.info({ connector_id: row.id, slug: row.slug }, 'connector created')
  return mapConnector(row)
}

async function getConnectorRow(id: DataConnectorId): Promise<ConnectorRow> {
  const [row] = await db.select().from(dataConnectors).where(eq(dataConnectors.id, id)).limit(1)
  if (!row) throw new NotFoundError('CONNECTOR_NOT_FOUND', 'Connector not found')
  return row
}

export async function updateConnector(
  id: DataConnectorId,
  input: UpdateConnectorInput
): Promise<DataConnector> {
  const existing = await getConnectorRow(id)

  const name = input.name !== undefined ? input.name.trim() : existing.name
  if (!name) throw new ValidationError('VALIDATION_ERROR', 'Connector name is required')
  const slug = input.name !== undefined ? toConnectorSlug(name) : existing.slug
  if (!slug) throw new ValidationError('VALIDATION_ERROR', 'Could not derive a slug from the name')

  if (input.urlTemplate !== undefined) validateUrlTemplate(input.urlTemplate)
  const inputs = input.inputs ?? existing.inputs
  if (input.inputs !== undefined) validateInputs(inputs)
  const headers = input.headers ?? existing.headers
  if (input.headers !== undefined) validateHeaders(headers)
  const auth = input.auth ?? existing.auth
  const secretAvailable = input.clearSecret
    ? Boolean(input.secret)
    : Boolean(input.secret) || existing.secretCiphertext !== null
  validateAuthConfig(auth, secretAvailable)
  const timeoutMs = input.timeoutMs ?? existing.timeoutMs
  if (input.timeoutMs !== undefined) validateTimeout(timeoutMs)

  if (input.name !== undefined && (name !== existing.name || slug !== existing.slug)) {
    await assertNameAndSlugAvailable(name, slug, id)
    await assertNoStaticToolCollision(slug)
  }

  const secretCiphertext = input.clearSecret
    ? null
    : input.secret
      ? encryptConnectorSecret(input.secret)
      : existing.secretCiphertext

  const [row] = await db
    .update(dataConnectors)
    .set({
      name,
      slug,
      description: input.description ?? existing.description,
      method: input.method ?? existing.method,
      urlTemplate: input.urlTemplate ?? existing.urlTemplate,
      headers,
      auth,
      secretCiphertext,
      inputs,
      bodyTemplate: input.bodyTemplate !== undefined ? input.bodyTemplate : existing.bodyTemplate,
      timeoutMs,
      enabled: input.enabled ?? existing.enabled,
      status: input.status ?? existing.status,
      // Re-enabling clears the circuit breaker, mirroring webhook re-enable.
      ...(input.status === 'active' && existing.status === 'disabled'
        ? { failureCount: 0, lastError: null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(dataConnectors.id, id))
    .returning()

  log.info({ connector_id: id }, 'connector updated')
  return mapConnector(row)
}

export async function deleteConnector(id: DataConnectorId): Promise<void> {
  const [deleted] = await db.delete(dataConnectors).where(eq(dataConnectors.id, id)).returning()
  if (!deleted) throw new NotFoundError('CONNECTOR_NOT_FOUND', 'Connector not found')
  log.info({ connector_id: id }, 'connector deleted')
}

export async function getConnector(id: DataConnectorId): Promise<DataConnector> {
  return mapConnector(await getConnectorRow(id))
}

export async function listConnectors(): Promise<DataConnector[]> {
  const rows = await db.query.dataConnectors.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  })
  return rows.map(mapConnector)
}

/** Enabled, non-circuit-broken connectors — the set resolveToolSpecs projects
 *  into model-facing tools (connector.toolspec.ts). */
export async function listEnabledConnectors(): Promise<DataConnector[]> {
  const rows = await db.query.dataConnectors.findMany({
    where: (t, { and, eq: eqOp }) => and(eqOp(t.enabled, true), eqOp(t.status, 'active')),
  })
  return rows.map(mapConnector)
}

/** Raw row lookup for execution paths (connector.execute.ts) that need the
 *  (never-DTO'd) secret ciphertext. */
export async function getConnectorRowForExecution(id: DataConnectorId): Promise<ConnectorRow> {
  return getConnectorRow(id)
}
