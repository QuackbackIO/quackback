/**
 * API Key Service - Business logic for API key operations
 *
 * Handles creation, validation, rotation, and revocation of API keys
 * for public API authentication.
 */

import { db, apiKeys, principal, eq, and, gt, isNull, or } from '@/lib/server/db'
import { emit } from '@/lib/server/events/emit'
import { apiKeyCreated, apiKeyDeleted, apiKeyUpdated } from '@/lib/server/events/catalogue'
import type { PrincipalId } from '@quackback/ids'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import { isAdmin } from '@/lib/shared/roles'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createServicePrincipal } from '@/lib/server/domains/principals/principal.service'
import {
  setPrincipalRole,
  updatePrincipalFields,
  syncPrincipalProfileById,
} from '@/lib/server/domains/principals/principal.factory'
import {
  API_KEY_SCOPES,
  EMPTY_SCOPES_MESSAGE,
  expandWriteGrants,
  parseApiKeyScopes,
  parseScopesJson,
} from './api-key-scopes'
import type {
  ApiKey,
  ApiKeyGranter,
  ApiKeyId,
  ApiKeyKind,
  CreateApiKeyInput,
  CreateApiKeyResult,
} from './api-key.types'
import {
  applyWorkspaceKeyRole,
  assertCanManageWorkspaceKey,
  resolveGrantableKeyRole,
  type WorkspaceKeyRole,
} from './workspace-key-role'
import type { RoleId } from '@quackback/ids'
export type { ApiKey, ApiKeyGranter, ApiKeyId, ApiKeyKind, CreateApiKeyInput, CreateApiKeyResult }

/** API key prefix */
const API_KEY_PREFIX = 'qb_'

/** Length of the random part of the key (in bytes, will be hex encoded) */
const KEY_RANDOM_BYTES = 24 // 48 hex chars

type ApiKeyRow = typeof apiKeys.$inferSelect

/**
 * Limits a change to keys of one kind and, for a teammate's own keys, one
 * creator. A key outside the filter is not found, the same as a missing one.
 */
export interface ApiKeyFilter {
  kind?: ApiKeyKind
  createdById?: PrincipalId
  /**
   * Whoever changes a workspace key must be able to grant the role it holds
   * now, or rotating it would hand them that role's authority.
   */
  granter?: ApiKeyGranter
}

/** Refuse a change to a workspace key whose role the filter's granter cannot grant. */
async function assertFilterMayManage(id: ApiKeyId, filter: ApiKeyFilter): Promise<void> {
  if (!filter.granter) return
  const key = await db.query.apiKeys.findFirst({ where: liveKeyWhere(id, filter) })
  if (!key) throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found or already revoked')
  if (key.kind === 'workspace') await assertCanManageWorkspaceKey(key.principalId, filter.granter)
}

function liveKeyWhere(id: ApiKeyId, filter: ApiKeyFilter) {
  return and(
    eq(apiKeys.id, id),
    isNull(apiKeys.revokedAt),
    filter.kind ? eq(apiKeys.kind, filter.kind) : undefined,
    filter.createdById ? eq(apiKeys.createdById, filter.createdById) : undefined
  )
}

/** Map a database row to the public ApiKey shape (strips keyHash, parses scopes). */
function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    keyPrefix: row.keyPrefix,
    createdById: row.createdById,
    principalId: row.principalId,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    scopes: parseApiKeyScopes(row.scopes),
  }
}

/**
 * Validate + normalize the scopes for a new key. Undefined/null means a legacy
 * full-authority key (stored NULL). A provided list must be non-empty and drawn
 * from the vocabulary; write implies the sibling read, then the set is
 * stored in vocabulary order.
 */
function normalizeScopesInput(scopes: CreateApiKeyInput['scopes']): string | null {
  if (scopes === undefined || scopes === null) return null
  const unknown = scopes.filter((s) => !API_KEY_SCOPES.includes(s))
  if (unknown.length > 0) {
    throw new ValidationError('VALIDATION_ERROR', `Unknown API key scope(s): ${unknown.join(', ')}`)
  }
  const ordered = expandWriteGrants(scopes)
  if (ordered.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', EMPTY_SCOPES_MESSAGE)
  }
  return JSON.stringify(ordered)
}

/**
 * Generate a new API key
 *
 * Format: qb_<48 hex chars>
 * Example: qb_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4
 */
function generateApiKey(): string {
  const randomPart = randomBytes(KEY_RANDOM_BYTES).toString('hex')
  return `${API_KEY_PREFIX}${randomPart}`
}

/**
 * Hash an API key for storage
 *
 * Uses SHA-256 to create a one-way hash of the key
 */
function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Extract the prefix from an API key for identification
 *
 * Returns the first 12 characters (e.g., "qb_a1b2c3d4")
 */
function getKeyPrefix(key: string): string {
  return key.substring(0, 12)
}

/**
 * Create a new API key.
 *
 * A personal key (the default) acts as `createdById`. A workspace key needs a
 * `roleId` and the creator's own authority as `granter`: the role is checked
 * against it exactly as re-roling a teammate is, then held by the key itself.
 */
export async function createApiKey(
  input: CreateApiKeyInput,
  createdById: PrincipalId,
  granter?: ApiKeyGranter
): Promise<CreateApiKeyResult> {
  // Validate input
  if (!input.name?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'API key name is required')
  }
  if (input.name.length > 255) {
    throw new ValidationError('VALIDATION_ERROR', 'API key name must be 255 characters or less')
  }

  const storedScopes = normalizeScopesInput(input.scopes)
  const kind: ApiKeyKind = input.kind ?? 'personal'
  let workspaceRole: WorkspaceKeyRole | null = null
  if (kind === 'workspace') {
    if (!input.roleId) {
      throw new ValidationError('VALIDATION_ERROR', 'A workspace key needs a role')
    }
    if (!granter) {
      throw new ForbiddenError('GRANT_CEILING', 'Creator permission set is required')
    }
    workspaceRole = await resolveGrantableKeyRole(input.roleId, granter)
  }

  // Generate the key
  const plainTextKey = generateApiKey()
  const keyHash = hashApiKey(plainTextKey)
  const keyPrefix = getKeyPrefix(plainTextKey)

  // Look up creator's role for the service principal
  const creator = await db.query.principal.findFirst({
    where: eq(principal.id, createdById),
    columns: { role: true },
  })
  const role =
    workspaceRole?.legacyRole ??
    ((isAdmin(creator?.role) ? 'admin' : 'member') as 'admin' | 'member')

  // The principal, the key row and (for a workspace key) its role grant are one
  // transaction: a grant that fails, say because the role was just deleted,
  // must not leave a live key behind on a fallback preset.
  const apiKey = await db.transaction(async (tx) => {
    const servicePrincipal = await createServicePrincipal(
      {
        role,
        displayName: input.name.trim(),
        serviceMetadata: { kind: 'api_key', apiKeyId: '' }, // Will be updated below
      },
      tx
    )

    const [row] = await tx
      .insert(apiKeys)
      .values({
        name: input.name.trim(),
        kind,
        keyHash,
        keyPrefix,
        createdById,
        principalId: servicePrincipal.id,
        expiresAt: input.expiresAt ?? null,
        scopes: storedScopes,
      })
      .returning()

    // Update service principal with the actual apiKeyId
    await updatePrincipalFields(
      { principalId: servicePrincipal.id },
      { serviceMetadata: { kind: 'api_key', apiKeyId: row.id } },
      { executor: tx }
    )

    if (workspaceRole) {
      await applyWorkspaceKeyRole(servicePrincipal.id, workspaceRole, createdById, tx)
    }
    return row
  })

  // EVENTING-V2 WO-6a: emit the audit-relevant creation event. A short tx since
  // this service has no surrounding one; exposure.audit writes the audit_log row
  // in the same tx (best-effort — a failure must not fail key creation).
  try {
    await db.transaction((tx) =>
      emit(tx, apiKeyCreated, {
        payload: {
          apiKeyId: apiKey.id,
          name: apiKey.name,
          scopes: storedScopes,
          kind,
          ...(workspaceRole ? { roleName: workspaceRole.roleName } : {}),
        },
        actor: { type: 'user', id: createdById },
        entityId: apiKey.id,
        context: { source: 'admin' },
      })
    )
  } catch {
    /* best-effort emission; never blocks key creation */
  }

  return { apiKey: toApiKey(apiKey), plainTextKey }
}

/**
 * Verify an API key and return the key record if valid.
 *
 * Uses prefix-based DB lookup + timing-safe hash comparison to prevent
 * timing oracle attacks. Returns null if the key is invalid, expired, or revoked.
 *
 * If `scope` is provided, the key must carry that capability scope or the
 * call returns null. Used by /api/v1/internal/* endpoints which require
 * the `internal:tier-limits` scope.
 */
export async function verifyApiKey(key: string, scope?: string): Promise<ApiKey | null> {
  if (!key || !key.startsWith(API_KEY_PREFIX)) return null

  const keyPrefix = getKeyPrefix(key)
  const keyHash = hashApiKey(key)

  // Look up by prefix (non-secret) instead of hash to avoid DB-level timing leak
  const apiKey = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.keyPrefix, keyPrefix), isNull(apiKeys.revokedAt)),
  })

  // Always perform timing-safe comparison even if no key found (constant-time path)
  const storedHash = apiKey?.keyHash ?? '0'.repeat(64)
  const hashesMatch = timingSafeEqual(Buffer.from(keyHash, 'hex'), Buffer.from(storedHash, 'hex'))

  if (!apiKey || !hashesMatch) return null
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null

  if (scope && !hasScope(apiKey.scopes, scope)) return null

  // Update last used timestamp (fire and forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, apiKey.id))
    .execute()
    .catch(() => {
      // Ignore errors updating last used timestamp
    })

  return toApiKey(apiKey)
}

/**
 * Whether the raw stored scopes hold `scope`. Unlike the vocabulary-filtered
 * parseApiKeyScopes, this matches ANY stored entry (internal capability
 * scopes such as `internal:tier-limits`) and fails closed: no stored scopes
 * means no internal capability.
 */
function hasScope(scopesRaw: string | null, scope: string): boolean {
  if (!scopesRaw) return false
  return parseScopesJson(scopesRaw)?.includes(scope) ?? false
}

/**
 * Rotate an API key - generates a new key and invalidates the old one
 *
 * Uses atomic UPDATE with WHERE clause to prevent race conditions
 * (HTTP-driver compatible, no interactive transactions)
 */
export async function rotateApiKey(
  id: ApiKeyId,
  filter: ApiKeyFilter = {}
): Promise<CreateApiKeyResult> {
  // Generate new key credentials
  const plainTextKey = generateApiKey()
  const keyHash = hashApiKey(plainTextKey)
  const keyPrefix = getKeyPrefix(plainTextKey)

  // Lock the key row for the whole rotation. A role change holds the same lock
  // while it writes, so the ceiling is checked against the role the new secret
  // will actually carry. The key must exist, be live and not have expired (a
  // new secret for an expired key would not work).
  return db.transaction(async (tx) => {
    const [key] = await tx
      .select()
      .from(apiKeys)
      .where(
        and(
          liveKeyWhere(id, filter),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))
        )
      )
      .limit(1)
      .for('update')
    if (!key) {
      throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found or already revoked')
    }
    if (filter.granter && key.kind === 'workspace') {
      await assertCanManageWorkspaceKey(key.principalId, filter.granter)
    }

    const [updatedKey] = await tx
      .update(apiKeys)
      .set({
        keyHash,
        keyPrefix,
        lastUsedAt: null, // Reset last used
      })
      .where(eq(apiKeys.id, key.id))
      .returning()
    return { apiKey: toApiKey(updatedKey), plainTextKey }
  })
}

/**
 * Revoke an API key (soft delete)
 */
export async function revokeApiKey(id: ApiKeyId, filter: ApiKeyFilter = {}): Promise<void> {
  const result = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(liveKeyWhere(id, filter))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found or already revoked')
  }

  // Downgrade the service principal so it no longer counts as admin/member
  const revokedKey = result[0]
  if (revokedKey.principalId) {
    // The factory resolves the row's userId and busts PRINCIPAL_BY_USER if set.
    // A service principal has no userId, so this stays a no-op cache-wise, as before.
    await setPrincipalRole({ principalId: revokedKey.principalId }, 'user')
  }

  // EVENTING-V2 WO-6a: audit-relevant deletion event. The actor isn't threaded
  // into this signature yet (WO-6 refinement), so it is attributed to the
  // service plane for now. Best-effort, same as create.
  try {
    await db.transaction((tx) =>
      emit(tx, apiKeyDeleted, {
        payload: { apiKeyId: id },
        actor: { type: 'service' },
        entityId: id,
        context: { source: 'admin' },
      })
    )
  } catch {
    /* best-effort emission; never blocks revocation */
  }
}

/**
 * List all active API keys (excludes revoked)
 */
export async function listApiKeys(): Promise<ApiKey[]> {
  const keys = await db.query.apiKeys.findMany({
    where: isNull(apiKeys.revokedAt),
    orderBy: (apiKeys, { desc }) => [desc(apiKeys.createdAt)],
  })

  return keys.map(toApiKey)
}

/** One teammate's live personal keys, newest first. */
export async function listPersonalApiKeys(createdById: PrincipalId): Promise<ApiKey[]> {
  const keys = await db.query.apiKeys.findMany({
    where: and(
      isNull(apiKeys.revokedAt),
      eq(apiKeys.kind, 'personal'),
      eq(apiKeys.createdById, createdById)
    ),
    orderBy: (apiKeys, { desc }) => [desc(apiKeys.createdAt)],
  })
  return keys.map(toApiKey)
}

/**
 * Get an API key by ID
 */
export async function getApiKeyById(id: ApiKeyId): Promise<ApiKey> {
  const apiKey = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.id, id),
  })

  if (!apiKey) {
    throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found')
  }

  return toApiKey(apiKey)
}

/**
 * Update an API key's name
 */
export async function updateApiKeyName(
  id: ApiKeyId,
  name: string,
  filter: ApiKeyFilter = {}
): Promise<ApiKey> {
  if (!name?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'API key name is required')
  }
  if (name.length > 255) {
    throw new ValidationError('VALIDATION_ERROR', 'API key name must be 255 characters or less')
  }

  await assertFilterMayManage(id, filter)

  const [updated] = await db
    .update(apiKeys)
    .set({ name: name.trim() })
    .where(liveKeyWhere(id, filter))
    .returning()

  if (!updated) {
    throw new NotFoundError('API_KEY_NOT_FOUND', 'API key not found')
  }

  // Sync name to the service principal
  await syncPrincipalProfileById(updated.principalId, { displayName: name.trim() })

  return toApiKey(updated)
}

/**
 * Give a workspace key a different role. Any holder of key management may do
 * this, within the same grant ceiling as creating one. Personal keys have no
 * role of their own (they act as their creator), so they are not found here.
 */
export async function setWorkspaceKeyRole(
  id: ApiKeyId,
  roleId: RoleId,
  granter: ApiKeyGranter,
  grantedBy: PrincipalId
): Promise<ApiKey> {
  const role = await resolveGrantableKeyRole(roleId, granter)
  // Lock the key row for the whole change. Revoking updates that row, so a
  // revoke either waits and then demotes the key's principal last, or commits
  // first and this finds no live key. A revoked key is never re-promoted.
  return db.transaction(async (tx) => {
    const [key] = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt), eq(apiKeys.kind, 'workspace')))
      .limit(1)
      .for('update')
    if (!key) throw new NotFoundError('API_KEY_NOT_FOUND', 'Workspace key not found')
    // The role it holds now must be one the caller could grant, as well as the new one.
    await assertCanManageWorkspaceKey(key.principalId, granter)
    await applyWorkspaceKeyRole(key.principalId, role, grantedBy, tx)
    await emit(tx, apiKeyUpdated, {
      payload: { apiKeyId: key.id, changedKeys: ['role'], roleName: role.roleName },
      actor: { type: 'user', id: grantedBy },
      entityId: key.id,
      context: { source: 'admin' },
    })
    return toApiKey(key)
  })
}
